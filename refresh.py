"""Publish an atomic, reproducible snapshot from Meteotrentino daily observations."""
import argparse
import base64
import fcntl
import json
import math
import os
import re
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pyarrow.parquet as pq
from shapely import contains_xy, make_valid, orient_polygons, union_all
from shapely.geometry import mapping, shape

SOURCE = "https://archivio.meteotrentino.it/share/"
ZONES = (
    "https://geoservices.provincia.tn.it/agol/rest/services/geologico/0_CGeom_Inq/MapServer/4/query"
    "?where=1%3D1&outFields=OBJECTID,nome&outSR=4326&geometryPrecision=5&f=geojson"
)
ZONE_NAMES = [
    "Alta Valsugana e Bersntol", "Paganella", "Valsugana e Tesino", "Vallagarina",
    "Rotaliana–Königsberg", "Alto Garda e Ledro", "Val di Sole", "Val di Fiemme",
    "Val di Cembra", "Primiero", "Val d’Adige", "Valle dei Laghi", "Val di Non",
    "Altipiani Cimbri", "Val di Fassa", "Giudicarie",
]
SOLAR = timezone(timedelta(hours=1))
DAY = timedelta(days=1)
MISSING = -32768
STRIDE = 3
BANDS = {"all": (0, 5000), "low": (0, 800), "mid": (800, 1400), "high": (1400, 5000)}
SCALES = {"frost": 1, "rain": 10, "storm": 10, "heat": 1, "gdd": 1, "mean": 10}


def fetch(url, target, reuse=False):
    if reuse and target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        tmp = target.with_suffix(target.suffix + ".tmp")
        try:
            request = Request(url, headers={"User-Agent": "AtlanteMeteoTrentino/1.0", "Cache-Control": "no-cache"})
            with urlopen(request, timeout=60) as response, tmp.open("wb") as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
            tmp.replace(target)
            return target
        except OSError:
            tmp.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def read_json(path):
    return json.loads(path.read_text())


def eligible(n, missing, expected):
    return missing == 0 and n >= math.ceil(0.95 * expected)


def read_days(path, first, last, variables, stations, expected):
    parquet = pq.ParquetFile(path)
    groups = []
    for i in range(parquet.num_row_groups):
        stats = parquet.metadata.row_group(i).column(1).statistics
        if stats is None or not stats.has_min_max or stats.max >= first and stats.min <= last:
            groups.append(i)
    rows = parquet.read_row_groups(groups, columns=["station", "date", "n", "n_missing", *variables])
    out = {}
    for row in rows.to_pylist():
        day = row["date"]
        idx = stations.get(row["station"])
        values = [row[var] for var in variables]
        if (idx is not None and first <= day <= last and eligible(row["n"], row["n_missing"], expected)
                and all(v is not None and math.isfinite(v) for v in values)):
            if variables == ["sum"] and values[0] < 0:
                continue
            out.setdefault(day, {})[idx] = values
    return out


def distances(lon, lat, station_lon, station_lat):
    mid = np.deg2rad((lat[:, None] + station_lat) / 2)
    return 111.195 * np.hypot((lon[:, None] - station_lon) * np.cos(mid), lat[:, None] - station_lat)


def estimate(d, station_z, grid_z, values, temperature):
    """IDW of the six closest available stations; temperature uses elevation residuals."""
    if len(values) < 3:
        return np.full(len(grid_z), np.nan)
    k = min(6, len(values))
    indices = np.argpartition(d, k - 1, axis=1)[:, :k]
    near = np.take_along_axis(d, indices, axis=1)
    weights = np.where(near <= 30, 1 / np.maximum(near, 0.3) ** 2, 0)
    slope = 0
    if temperature and len(values) >= 8 and np.ptp(station_z) >= 500:
        centered = station_z - station_z.mean()
        slope = np.clip(centered @ (values - values.mean()) / (centered @ centered), -0.012, 0.004)
    residual = values - slope * station_z
    valid = (near.min(axis=1) <= 15) & ((near <= 30).sum(axis=1) >= 3)
    if temperature:
        nearby_z = np.where(near <= 30, station_z[indices], -np.inf)
        valid &= grid_z <= nearby_z.max(axis=1) + 550
    numerator = (weights * residual[indices]).sum(axis=1)
    denominator = weights.sum(axis=1)
    return np.divide(numerator, denominator, out=np.full_like(numerator, np.nan), where=valid) + slope * grid_z


def dates(first, last):
    return (first + DAY * i for i in range(max(0, (last - first).days + 1)))


def season(last):
    year = last.year - (last < date(last.year, 4, 1))
    return date(year, 4, 1), min(last, date(year, 10, 31))


def complete_reduce(rows, transform, reduction):
    data = np.stack(rows)
    return reduction(transform(data), axis=0).astype(float, copy=False)


def frost_indicator(data):
    return np.where(np.isfinite(data), (data <= 0).astype(float), np.nan)


def heat_indicator(data):
    return np.where(np.isfinite(data), (data >= 30).astype(float), np.nan)


def encoded(values):
    packed = np.where(np.isfinite(values), np.rint(values), MISSING).astype("<i2")
    return base64.b64encode(packed.tobytes()).decode()


def round_settings(v):
    if isinstance(v, (tuple, list)):
        return [round_settings(x) for x in v]
    return round(v, 5)


def polygon_parts(geometry):
    if geometry.geom_type == "Polygon":
        yield geometry
    elif geometry.geom_type in {"MultiPolygon", "GeometryCollection"}:
        for part in geometry.geoms:
            yield from polygon_parts(part)


def grid_and_zones(dem_meta, dem_file, boundaries):
    nx, ny = dem_meta["nx"], dem_meta["ny"]
    # Downsample with center sampling; preserve source origin and cell alignment.
    xs, ys = np.arange(1, nx, STRIDE), np.arange(1, ny, STRIDE)
    raw = np.fromfile(dem_file, dtype="<i2").reshape(ny, nx)[np.ix_(ys, xs)]
    grid = {"w": len(xs), "h": len(ys), "west": dem_meta["west"], "north": dem_meta["north"],
            "dx": dem_meta["dlon"] * STRIDE, "dy": dem_meta["dlat"] * STRIDE}
    lon, lat = np.meshgrid(grid["west"] + (xs + 0.5) * dem_meta["dlon"],
                           grid["north"] - (ys + 0.5) * dem_meta["dlat"])
    in_province = raw != dem_meta["nodata"]
    picked_lon, picked_lat, z = lon[in_province], lat[in_province], raw[in_province].astype(float)
    zone_idx = np.zeros(len(z), dtype=np.int8)
    zones = []
    for feature in boundaries.get("features", []):
        i = int(feature["properties"]["OBJECTID"])
        geom = union_all(list(polygon_parts(make_valid(shape(feature["geometry"])))))
        zone_idx[contains_xy(geom, picked_lon, picked_lat)] = i
        simplified = orient_polygons(geom.simplify(0.00065, preserve_topology=True))
        geometry = mapping(simplified)
        point = geom.representative_point()
        zones.append({"id": i, "name": ZONE_NAMES[i-1], "geometry": {
            "type": geometry["type"], "coordinates": round_settings(geometry["coordinates"])
        }, "center": [round(point.x, 5), round(point.y, 5)]})
    if len(zones) != 16 or (zone_idx > 0).mean() < 0.96:
        raise ValueError("Unexpected administrative boundary coverage")
    return grid, in_province, picked_lon, picked_lat, z, zone_idx, zones


def summarize(fields, z, zone_idx, zones):
    for zone in zones:
        bands = {}
        for band, (lo, hi) in BANDS.items():
            mask = (zone_idx == zone["id"]) & (lo <= z) & (z < hi)
            stats = {}
            for key, values in fields.items():
                covered = values[mask & np.isfinite(values)]
                if covered.size:
                    stats[key] = {
                        "mean": round(float(covered.mean()), 1), "min": round(float(covered.min()), 1),
                        "max": round(float(covered.max()), 1), "coverage": round(float(covered.size / mask.sum()), 3),
                    }
            bands[band] = {"km2": round(float(mask.sum() * 0.75 ** 2), 1), "stats": stats}
        zone["bands"] = bands


def snapshot(summary, station_catalog, boundaries, dem_meta, dem, temp_path, rain_path):
    generated = datetime.fromisoformat(summary["generated_at"]).astimezone(SOLAR)
    last = generated.date() - DAY
    first = last - 29 * DAY
    grow_start, grow_end = season(last)
    stations = []
    for f in station_catalog["features"]:
        p = f["properties"]
        position = f.get("geometry")
        if p.get("alt") is not None and position and position["type"] == "Point":
            lon, lat = position["coordinates"]
            if 10 < lon < 13 and 45 < lat < 48:
                stations.append({"id": p["code"], "name": p["name"], "z": p["alt"], "lon": lon, "lat": lat})
    index = {s["id"]: i for i, s in enumerate(stations)}
    temp = read_days(temp_path, min(first, grow_start), last, ["min", "mean", "max"], index, 96)
    rain = read_days(rain_path, first, last, ["sum"], index, 288)
    # A delayed or partial upstream release must not replace the last good published snapshot.
    if min(len(temp.get(last, {})), len(rain.get(last, {}))) < 20:
        raise ValueError(f"Insufficient station data for last complete solar day {last.isoformat()}")
    grid, mask, lon, lat, z, zone_idx, zones = grid_and_zones(dem_meta, dem, boundaries)
    slon, slat, sz = (np.array([s[k] for s in stations]) for k in ("lon", "lat", "z"))
    d = distances(lon, lat, slon, slat)

    def project(samples, idx, temperature):
        if not samples:
            return np.full(len(z), np.nan)
        ids = list(samples)
        return estimate(d[:, ids], sz[ids], z, np.array(list(samples.values()))[:, idx], temperature)

    recent = list(dates(first, last))
    frost = complete_reduce([project(temp.get(day), 0, True) for day in recent], frost_indicator, np.sum)
    heat = complete_reduce([project(temp.get(day), 2, True) for day in recent], heat_indicator, np.sum)
    rainfall = [project(rain.get(day), 0, False) for day in recent]
    gdd = complete_reduce([project(temp.get(day), 1, True) for day in dates(grow_start, grow_end)],
                          lambda v: np.maximum(v - 10, 0), np.sum)
    fields = {
        "frost": frost, "rain": np.sum(rainfall, axis=0), "storm": np.max(rainfall, axis=0),
        "heat": heat, "gdd": gdd, "mean": project(temp[last], 1, True),
    }
    if any(np.isfinite(x).mean() < 0.20 for x in fields.values()):
        raise ValueError("Less than 20% provincial coverage on an indicator; retaining the previous snapshot")
    summarize(fields, z, zone_idx, zones)

    def pack(values):
        raster = np.full(mask.shape, np.nan)
        raster[mask] = values
        return encoded(raster)

    visible_stations = []
    for i in sorted(temp[last].keys() | rain[last].keys()):
        point = dict(stations[i])
        if i in temp[last]:
            point.update(dict(zip(("min", "mean", "max"), [round(float(v), 1) for v in temp[last][i]])))
        if i in rain[last]:
            point["rain"] = round(float(rain[last][i][0]), 1)
        visible_stations.append(point)
    return {
        "schema": 1, "sourceVersion": summary["version"], "sourceGeneratedAt": summary["generated_at"],
        "latest": last.isoformat(), "start": first.isoformat(),
        "seasonStart": grow_start.isoformat(), "seasonEnd": grow_end.isoformat(),
        "grid": grid, "elevation": pack(z), "zoneGrid": pack(zone_idx),
        "layers": {k: {"data": pack(v * SCALES[k]), "scale": SCALES[k]} for k, v in fields.items()},
        "zones": zones, "stations": visible_stations,
    }


def refresh(output, cache, trigger):
    output.parent.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    with (cache / "refresh.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        summary = read_json(fetch(SOURCE + "catalog/summary.json", cache / "summary.json"))
        files = {x["code"]: x["daily"] for x in summary["aggregates"]}
        fresh = (datetime.now(UTC) - datetime.fromisoformat(summary["generated_at"])) <= timedelta(days=2)
        if not fresh:
            raise ValueError("Upstream archive is more than 48 hours old")
        if output.exists():
            existing = read_json(output)
            if existing.get("sourceVersion", "") > summary["version"]:
                raise ValueError("Upstream catalog version went backwards")
            if existing.get("sourceVersion") == summary["version"] and existing.get("pipelineVersion") == 1:
                print(json.dumps({"event": "unchanged", "trigger": trigger, "sourceVersion": summary["version"]}))
                return
        paths = [files["400.00"], files["10.00"]]
        if any(not re.fullmatch(r"aggregates/daily/(400|10)\.00\.v[\w-]+\.parquet", p) for p in paths):
            raise ValueError("Unexpected upstream aggregate path")
        with ThreadPoolExecutor(max_workers=6) as pool:
            jobs = [
                pool.submit(fetch, SOURCE + "catalog/stations.json", cache / "stations.json"),
                pool.submit(fetch, ZONES, cache / "zones.geojson", True),
                pool.submit(fetch, SOURCE + "assets/dem_250m.json", cache / "dem_250m.json", True),
                pool.submit(fetch, SOURCE + "assets/dem_250m.bin", cache / "dem_250m.bin", True),
                *[pool.submit(fetch, SOURCE + p, cache / Path(p).name, True) for p in paths],
            ]
            stations, zones, header, dem, temp, rain = [j.result() for j in jobs]
        payload = snapshot(summary, read_json(stations), read_json(zones), read_json(header), dem, temp, rain)
        payload.update({"updatedAt": datetime.now(UTC).isoformat(), "trigger": trigger, "pipelineVersion": 1})
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as tmp:
            json.dump(payload, tmp, allow_nan=False, separators=(",", ":"), ensure_ascii=False)
        os.replace(tmp.name, output)
        for path in cache.glob("*.parquet"):
            if path not in (temp, rain):
                path.unlink()
        print(json.dumps({
            "event": "published", "trigger": trigger, "updatedAt": payload["updatedAt"],
            "sourceVersion": payload["sourceVersion"], "latest": payload["latest"],
            "stations": len(payload["stations"]), "zones": len(payload["zones"]),
        }), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("web/data/atlas.json"))
    parser.add_argument("--cache", type=Path, default=Path(".cache"))
    parser.add_argument("--trigger", choices=["manual", "cron", "programma", "deploy"], default="manual")
    args = parser.parse_args()
    refresh(args.output, args.cache, args.trigger)
