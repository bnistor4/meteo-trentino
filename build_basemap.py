"""Build the static cartography from an OpenFreeMap snapshot and the Meteotrentino DEM."""

import base64
import gzip
import json
import math
import struct
import sys
import zlib
from pathlib import Path

import mapbox_vector_tile
import numpy as np
from shapely import box, line_merge, make_valid, union_all
from shapely.geometry import shape
from shapely.ops import transform


def path(geometry):
    if geometry.is_empty:
        return ""
    if geometry.geom_type == "Polygon":
        return "".join(path(ring) + "Z" for ring in (geometry.exterior, *geometry.interiors))
    if geometry.geom_type in {"LinearRing", "LineString"}:
        return "M" + " ".join(f"{x:.1f},{y:.1f}" for x, y in geometry.coords)
    return "".join(path(part) for part in getattr(geometry, "geoms", ()))


def hillshade(dem_file, meta):
    z = np.fromfile(dem_file, dtype="<i2").reshape(meta["ny"], meta["nx"]).astype(float)
    valid = z != meta["nodata"]
    for axis in (0, 1):
        z = np.where(valid, z, np.maximum(np.roll(z, 1, axis=axis), np.roll(z, -1, axis=axis)))
    z[z == meta["nodata"]] = 0
    dy, dx = np.gradient(z / meta["res_m"])
    slope = (dy - dx) / np.sqrt(2 * (1 + dy**2 + dx**2))
    alpha = np.where(valid, np.minimum(100, np.abs(slope) * 135), 0)
    raster = np.stack((np.where(slope > 0, 255, 65), alpha), axis=-1).astype("uint8")

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    header = struct.pack(">IIBBBBB", meta["nx"], meta["ny"], 8, 4, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
    png += chunk(b"IDAT", zlib.compress(b"".join(b"\0" + row.tobytes() for row in raster), 9))
    return base64.b64encode(png + chunk(b"IEND", b"")).decode()


def build(tiles, metadata, heights):
    # The SVG uses the same linear lon/lat projection as the atlas, at 3× its grid scale.
    meta = json.loads(metadata.read_text())
    west, north, dx, dy = (meta[key] for key in ("west", "north", "dlon", "dlat"))
    width, height = meta["nx"], meta["ny"]
    # This fixed context covers the province and surrounding landmarks without runtime tile calls.
    extent = (-85, -100, width + 85, height + 85)
    crop = box(*extent)
    features = {"wood": [], "water": [], "rivers": [], "roads": []}
    for file in sorted(tiles):
        _, z, x, y = file.stem.split("-")
        zoom, tx, ty = int(z), int(x), int(y)
        raw = file.read_bytes()
        data = mapbox_vector_tile.decode(gzip.decompress(raw) if raw.startswith(b"\x1f\x8b") else raw,
                                         default_options={"y_coord_down": True})
        for source, target, classes in (
            ("landcover", "wood", {"wood"}), ("water", "water", {"lake", "river"}),
            ("waterway", "rivers", {"river"}), ("transportation", "roads", {"motorway", "trunk", "primary"}),
        ):
            layer = data.get(source, {})
            for item in layer.get("features", []):
                if item["properties"].get("class") not in classes:
                    continue

                def project(px, py):
                    n = layer["extent"]
                    lon = (tx + np.asarray(px) / n) / 2**zoom * 360 - 180
                    mercator = math.pi * (1 - 2 * (ty + np.asarray(py) / n) / 2**zoom)
                    lat = np.degrees(np.arctan(np.sinh(mercator)))
                    return (lon - west) / dx, (north - lat) / dy

                g = transform(project, shape(item["geometry"]))
                if not g.is_valid:
                    g = make_valid(g)
                left, top = project(0, 0)
                right, bottom = project(layer["extent"], layer["extent"])
                g = g.intersection(box(left, top, right, bottom)).intersection(crop).simplify(.45)
                if not g.is_empty and (target != "wood" or g.area > 450):
                    features[target].append(g)

    min_x, min_y, max_x, max_y = extent
    w, h = max_x - min_x, max_y - min_y
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{min_x} {min_y} {w} {h}">
<rect x="{min_x}" y="{min_y}" width="{w}" height="{h}" fill="#edf0e9"/>
<path fill="#e0e8d9" fill-rule="evenodd" d="{path(union_all(features['wood']).simplify(2))}"/>
<image width="{width}" height="{height}" href="data:image/png;base64,{hillshade(heights, meta)}"/>
<path fill="none" stroke="#bbd4dc" stroke-linecap="round" stroke-width="1.3" d="{path(line_merge(union_all(features['rivers'])).simplify(1.3))}"/>
<path fill="#bfd8e4" fill-rule="evenodd" d="{path(union_all(features['water']).simplify(.85))}"/>
<path fill="none" stroke="#acaaa0" stroke-linecap="round" stroke-width=".62" d="{path(line_merge(union_all(features['roads'])).simplify(2))}"/>
</svg>
"""


if __name__ == "__main__":
    source, dem_json, dem_bin, output = map(Path, sys.argv[1:])
    tiles = list(source.glob("osm-*.pbf"))
    if not tiles:
        raise SystemExit("No osm-Z-X-Y.pbf source tiles")
    output.write_bytes(gzip.compress(build(tiles, dem_json, dem_bin).encode(), mtime=0))
