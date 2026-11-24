"""Publish an atomic, reproducible snapshot from Meteotrentino daily observations."""
import argparse
import base64
import fcntl
import gzip
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
MUNICIPALITIES = (
    "https://geoservices.provincia.tn.it/agol/rest/services/geologico/0_CGeom_Inq/MapServer/5/query"
    "?where=1%3D1&outFields=codice,nome&outSR=4326&geometryPrecision=5&f=geojson"
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
RECENT_DAYS = 90
PIPELINE_VERSION = 4
DAILY_KEYS = ("min", "max", "mean", "rain")
EXTREMA_QUALITY = {1, 2, 3, 7, 145}


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


def read_days(path, first, last, variable, stations, expected, *, quality=None, complete=False):
    parquet = pq.ParquetFile(path)
    groups = []
    for i in range(parquet.num_row_groups):
        stats = parquet.metadata.row_group(i).column(1).statistics
        if stats is None or not stats.has_min_max or stats.max >= first and stats.min <= last:
            groups.append(i)
    columns = ["station", "date", "n", "n_missing", variable]
    if quality is not None:
        columns.append("quality")
    rows = parquet.read_row_groups(groups, columns=columns)
    out = {}
    for row in rows.to_pylist():
        day = row["date"]
        idx = stations.get(row["station"])
        value = row[variable]
        if (idx is not None and first <= day <= last and eligible(row["n"], row["n_missing"], expected)
                and (not complete or row["n"] == expected) and (quality is None or row["quality"] in quality)
                and value is not None and math.isfinite(value)):
            if variable == "sum" and value < 0:
                continue
            out.setdefault(day, {})[idx] = value
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


def summer(last):
    year = last.year - (last < date(last.year, 6, 1))
    return date(year, 6, 1), min(last, date(year, 8, 31))


def spring(last):
    year = last.year - (last < date(last.year, 3, 1))
    return date(year, 3, 1), min(last, date(year, 5, 31))


def complete_reduce(rows, transform, reduction):
    data = np.stack(rows)
    return reduction(transform(data), axis=0).astype(float, copy=False)


def frost_indicator(data):
    return np.where(np.isfinite(data), (data <= 0).astype(float), np.nan)


def heat_indicator(data):
    return np.where(np.isfinite(data), (data >= 30).astype(float), np.nan)


def encoded(values):
    packed = np.where(np.isfinite(values), np.rint(values).clip(-32767, 32767), MISSING).astype("<i2")
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


def territories(boundaries, lon, lat, id_key, name_of, tolerance):
    indices = np.zeros(len(lon), dtype=np.int16)
    areas = []
    for feature in boundaries.get("features", []):
        props = feature["properties"]
        i = int(props[id_key])
        geom = union_all(list(polygon_parts(make_valid(shape(feature["geometry"])))))
        indices[contains_xy(geom, lon, lat)] = i
        geometry = mapping(orient_polygons(geom.simplify(tolerance, preserve_topology=True)))
        point = geom.representative_point()
        areas.append({"id": i, "name": name_of(props, i), "geometry": {
            "type": geometry["type"], "coordinates": round_settings(geometry["coordinates"])
        }, "center": [round(point.x, 5), round(point.y, 5)]})
    return indices, areas


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
    zone_idx, zones = territories(boundaries, picked_lon, picked_lat, "OBJECTID",
                                  lambda _, i: ZONE_NAMES[i-1], 0.00065)
    if len(zones) != 16 or (zone_idx > 0).mean() < 0.96:
        raise ValueError("Unexpected administrative boundary coverage")
    return grid, in_province, picked_lon, picked_lat, z, zone_idx, zones


def held_out_error(d, elevations, samples, temperature):
    ids = np.array(list(samples))
    observed = np.array(list(samples.values()))
    errors = []
    for i, pos in enumerate(ids):
        keep = np.arange(len(ids)) != i
        prediction = estimate(d[pos:pos+1, ids[keep]], elevations[ids[keep]], elevations[pos:pos+1],
                              observed[keep], temperature)[0]
        if np.isfinite(prediction):
            errors.append(abs(prediction-observed[i]))
    return {"n": len(errors), "mae": round(float(np.mean(errors)), 1) if errors else None}


def rain_peak(rows, span):
    rolling = np.lib.stride_tricks.sliding_window_view(rows, span, axis=0).sum(axis=-1)
    values = rolling.max(axis=0)
    peaks = np.where(values > 0, rolling.argmax(axis=0) + span - 1, -1)
    return values, peaks


def snapshot(summary, station_catalog, boundaries, municipalities, dem_meta, dem, paths):
    generated = datetime.fromisoformat(summary["generated_at"]).astimezone(SOLAR)
    last = generated.date() - DAY
    first = last - 29 * DAY
    history_start = last - (RECENT_DAYS - 1) * DAY
    grow_start, grow_end = season(last)
    heat_start, heat_end = summer(last)
    spring_start, spring_end = spring(last)
    stations = []
    for f in station_catalog["features"]:
        p = f["properties"]
        position = f.get("geometry")
        if p.get("alt") is not None and position and position["type"] == "Point":
            lon, lat = position["coordinates"]
            if 10 < lon < 13 and 45 < lat < 48:
                stations.append({"id": p["code"], "name": p["name"], "z": p["alt"], "lon": lon, "lat": lat})
    index = {s["id"]: i for i, s in enumerate(stations)}
    lows = read_days(paths["400.55"], min(history_start, spring_start), last, "min", index, 1, quality=EXTREMA_QUALITY)
    highs = read_days(paths["400.56"], min(history_start, heat_start), last, "max", index, 1, quality=EXTREMA_QUALITY)
    means = read_days(paths["400.02"], min(history_start, grow_start), last, "mean", index, 96)
    rain = read_days(paths["10.00"], history_start, last, "sum", index, 288, complete=True)
    sources = {"min": lows, "max": highs, "mean": means, "rain": rain}
    # A delayed or partial upstream release must not replace the last good published snapshot.
    if min(len(source.get(last, {})) for source in sources.values()) < 20:
        raise ValueError(f"Insufficient station data for last complete solar day {last.isoformat()}")
    grid, mask, lon, lat, z, zone_idx, zones = grid_and_zones(dem_meta, dem, boundaries)
    comune_idx, comuni = territories(municipalities, lon, lat, "codice",
                                    lambda p, _: p["nome"].title().replace("' ", "'"), 0.00035)
    if len(comuni) < 150 or len({x["id"] for x in comuni}) != len(comuni) or (comune_idx > 0).mean() < 0.96:
        raise ValueError("Unexpected municipal boundary coverage")
    slon, slat, sz = (np.array([s[k] for s in stations]) for k in ("lon", "lat", "z"))
    d = distances(lon, lat, slon, slat)

    def project(samples, temperature):
        if not samples:
            return np.full(len(z), np.nan)
        ids = list(samples)
        return estimate(d[:, ids], sz[ids], z, np.array(list(samples.values())), temperature)

    recent = list(dates(history_start, last))
    daily = {k: np.stack([project(source.get(day), k != "rain") for day in recent])
             for k, source in sources.items()}
    heat = complete_reduce([project(highs.get(day), True) for day in dates(heat_start, heat_end)],
                           heat_indicator, np.sum)
    spring_frost = complete_reduce([project(lows.get(day), True) for day in dates(spring_start, spring_end)],
                                   frost_indicator, np.sum)
    gdd = complete_reduce([project(means.get(day), True) for day in dates(grow_start, grow_end)],
                          lambda v: np.maximum(v - 10, 0), np.sum)
    def quantize_daily(key, values):
        quantized = np.rint(values * 10).clip(-32767, 32767)
        if key == "min":
            quantized = np.where((values > 0) & (quantized == 0), 1, quantized)
        if key == "max":
            quantized = np.where((values < 30) & (quantized == 300), 299, quantized)
        return quantized

    def pack(values):
        raster = np.full(mask.shape, np.nan)
        raster[mask] = values
        return encoded(raster)

    quantized = {key: quantize_daily(key, daily[key]) for key in DAILY_KEYS}
    recent_rain = quantized["rain"][-30:]
    fields = {
        "frost": frost_indicator(quantized["min"][-30:]).sum(axis=0),
        "rain": recent_rain.sum(axis=0), "heat": heat, "spring": spring_frost,
        "gdd": gdd, "mean": quantized["mean"][-1],
    }
    peaks = {}
    for key, span in (("storm", 1), ("storm48", 2), ("storm72", 3)):
        fields[key], day_indices = rain_peak(recent_rain, span)
        peaks[key] = pack(np.where(day_indices >= 0, day_indices + RECENT_DAYS - 30, -1))
    if any(np.isfinite(x).mean() < 0.20 for x in fields.values()):
        raise ValueError("Less than 20% provincial coverage on an indicator; retaining the previous snapshot")
    layers = {key: {"data": pack(values), "scale": 10 if key in {"rain", "storm", "storm48", "storm72", "mean"} else 1}
              for key, values in fields.items()}
    for key, indices in peaks.items():
        layers[key]["peaks"] = indices
    series = np.full((len(DAILY_KEYS), len(recent), *mask.shape), MISSING, dtype="<i2")
    for i, key in enumerate(DAILY_KEYS):
        values = quantized[key]
        series[i][:, mask] = np.where(np.isfinite(values), values, MISSING)

    visible_stations = []
    for i in sorted(set().union(*(s[last] for s in sources.values()))):
        point = dict(stations[i])
        for key, source in sources.items():
            if i in source[last]:
                point[key] = round(float(source[last][i]), 1)
        visible_stations.append(point)
    between_stations = distances(slon, slat, slon, slat)
    validation = {k: held_out_error(between_stations, sz, s[last], k != "rain") for k, s in sources.items()}
    return {
        "schema": 3, "sourceVersion": summary["version"], "sourceGeneratedAt": summary["generated_at"],
        "latest": last.isoformat(), "start": first.isoformat(),
        "seasonStart": grow_start.isoformat(), "seasonEnd": grow_end.isoformat(),
        "heatStart": heat_start.isoformat(), "heatEnd": heat_end.isoformat(),
        "springStart": spring_start.isoformat(), "springEnd": spring_end.isoformat(),
        "grid": grid, "elevation": pack(z), "zoneGrid": pack(zone_idx), "comuneGrid": pack(comune_idx),
        "daily": {"start": history_start.isoformat(), "scale": 10, "keys": DAILY_KEYS},
        "layers": layers,
        "zones": zones, "comuni": comuni, "stations": visible_stations, "validation": validation,
    }, series


def write_gzip(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        with gzip.GzipFile(filename="", fileobj=tmp, mode="wb", compresslevel=5, mtime=0) as stream:
            stream.write(data)
    os.replace(tmp.name, path)


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
            with gzip.open(output, "rt", encoding="utf-8") as snapshot_file:
                existing = json.load(snapshot_file)
            if existing.get("sourceVersion", "") > summary["version"]:
                raise ValueError("Upstream catalog version went backwards")
            if existing.get("sourceVersion") == summary["version"] and existing.get("pipelineVersion") == PIPELINE_VERSION:
                print(json.dumps({"event": "unchanged", "trigger": trigger, "sourceVersion": summary["version"]}))
                return
        paths = {code: files[code] for code in ("400.55", "400.56", "400.02", "10.00")}
        if any(not re.fullmatch(rf"aggregates/daily/{re.escape(code)}\.v[\w-]+\.parquet", p) for code,p in paths.items()):
            raise ValueError("Unexpected upstream aggregate path")
        with ThreadPoolExecutor(max_workers=6) as pool:
            jobs = [
                pool.submit(fetch, SOURCE + "catalog/stations.json", cache / "stations.json"),
                pool.submit(fetch, ZONES, cache / "zones.geojson", True),
                pool.submit(fetch, MUNICIPALITIES, cache / "comuni.geojson", True),
                pool.submit(fetch, SOURCE + "assets/dem_250m.json", cache / "dem_250m.json", True),
                pool.submit(fetch, SOURCE + "assets/dem_250m.bin", cache / "dem_250m.bin", True),
                *[pool.submit(fetch, SOURCE + p, cache / Path(p).name, True) for p in paths.values()],
            ]
            stations, zones, comuni, header, dem, *aggregates = [j.result() for j in jobs]
        payload, series = snapshot(summary, read_json(stations), read_json(zones), read_json(comuni), read_json(header), dem,
                                   dict(zip(paths, aggregates)))
        payload.update({"updatedAt": datetime.now(UTC).isoformat(), "trigger": trigger, "pipelineVersion": PIPELINE_VERSION})
        version = payload["sourceVersion"]
        if not re.fullmatch(r"[0-9]{8}T[0-9]{4}", version):
            raise ValueError("Unexpected archive version")
        history = output.with_name(f"history-{PIPELINE_VERSION}-{version}.bin.gz")
        payload["daily"]["file"] = history.name
        write_gzip(history, memoryview(series).cast("B"))
        write_gzip(output, json.dumps(payload, allow_nan=False, separators=(",", ":"), ensure_ascii=False).encode())
        for old in sorted(output.parent.glob("history-*.bin.gz"), key=lambda path: path.stat().st_mtime, reverse=True)[2:]:
            old.unlink()
        for path in cache.glob("*.parquet"):
            if path not in aggregates:
                path.unlink()
        print(json.dumps({
            "event": "published", "trigger": trigger, "updatedAt": payload["updatedAt"],
            "sourceVersion": payload["sourceVersion"], "latest": payload["latest"],
            "stations": len(payload["stations"]), "zones": len(payload["zones"]),
        }), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("web/data/atlas.json.gz"))
    parser.add_argument("--cache", type=Path, default=Path(".cache"))
    parser.add_argument("--trigger", choices=["manual", "cron", "programma", "deploy"], default="manual")
    args = parser.parse_args()
    refresh(args.output, args.cache, args.trigger)
