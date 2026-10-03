#!/usr/bin/env bash
# Full map bake: OSM -> UTM JSON, orthophoto tiles, then LiDAR/MDT relief, building volumes and roofs
# (roof colours are sampled from the orthophoto), then the surroundings.
# Needs raw/derived/lidar_1m.npz (tools/geodata/lidar_rasters.py) and raw/ign/mdt5.tif.
set -euo pipefail
cd "$(dirname "$0")/../.."
# Point-cloud rasters (slow, only when the LiDAR changes): uncomment to rebuild.
# python3 tools/geodata/lidar_rasters.py raw/lidar raw/derived/lidar_1m.npz
# python3 tools/geodata/lidar_walls.py raw/lidar raw/derived/lidar_1m.npz raw/derived/lidar_walls.npz
node scripts/osm-to-map.ts data/villarcayo.osm public/maps/villarcayo.json
python3 tools/geodata/fetch_ortho.py public/maps/villarcayo.json public/maps/ortho
python3 tools/geodata/bake_terrain_buildings.py public/maps/villarcayo.json raw/derived/lidar_1m.npz raw/ign/mdt5.tif
python3 tools/geodata/fetch_surroundings.py public/maps/villarcayo.json
