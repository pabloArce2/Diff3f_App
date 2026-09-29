# Adding datasets to the correspondence viewer

The correspondence viewer lists every benchmark direction described in a file called
`correspondence_presets.json` anywhere under the backend's `visualizations/` folder. The
server reads these files each time the viewer loads (or when you press its refresh button),
so adding a dataset is: run the benchmark, write the JSON, refresh.

## What a direction needs

For a benchmark from specimen A to specimen B:

| File | Made by |
| --- | --- |
| `A_to_B_landmark_benchmark.csv` | `evaluate_landmark_benchmark.py` |
| `A_to_B_landmark_summary.json` | `evaluate_landmark_benchmark.py` |
| the OBJ of A and of B the descriptors were computed on | your pipeline |
| a PLY of A and of B to display | `visualize_feature_comparison.py` (the `_shared_pca_features.ply` files) |

The display PLYs must be triangle meshes with the same vertices, in the same order, as the
OBJs, because the benchmark CSV refers to vertices by index. The shared-PCA PLYs from
`visualize_feature_comparison.py` are exactly that, and they give both shapes comparable
colours. The viewer checks the vertex count and that the benchmark's endpoint coordinates
match the PLY within 0.001, and shows an error instead of drawing wrong lines.

Run the benchmark in both directions if you want both in the viewer; they are separate
datasets.

## The JSON file

```json
{
  "schemaVersion": 1,
  "id": "crickets-landmarks",
  "title": "Cricket landmark benchmark",
  "presets": [
    {
      "id": "brown-to-black",
      "label": "Brown cricket -> Black cricket",
      "source": {
        "name": "brownCricket",
        "indexGeometry": "meshes/bugnist_crickets/bcrick_10_010/BrownCricket_rotated.obj",
        "displayGeometry": "visualizations/crickets/shared_pca/brownCricket_shared_pca_features.ply"
      },
      "target": {
        "name": "blackCricket",
        "indexGeometry": "meshes/bugnist_crickets/sfaar_10_010/BlackCricket_10_10_rotated.obj",
        "displayGeometry": "visualizations/crickets/shared_pca/blackCricket_shared_pca_features.ply"
      },
      "benchmarkCsv": "visualizations/crickets/benchmark/brown_to_black/brownCricket_to_blackCricket_landmark_benchmark.csv",
      "summaryJson": "visualizations/crickets/benchmark/brown_to_black/brownCricket_to_blackCricket_landmark_summary.json"
    }
  ]
}
```

- `id` (file and preset): letters, digits, `.`, `_` and `-`; unique across all files.
- `title` groups the presets in the viewer's drop-down; `label` is the entry itself.
- `source.name` and `target.name` must be the `--source-name` / `--target-name` that were
  given to the benchmark (they are stored in the summary JSON).
- All paths are relative to the backend folder, with forward or back slashes, and may not
  leave it (`..` and absolute paths are rejected).

## If a dataset does not show up

The viewer shows the error message of the first problem it finds, for example a missing
file, a CSV without the expected columns, a direction that does not match the summary, or a
PLY with a different number of vertices. The same message appears in the server's terminal
output. Two example files from the project are in the backend under
`visualizations/bugnist_crickets_landmark_benchmark/updated_points_2026-09-04/` and
`visualizations/bugnist_long_10_002_landmark_benchmark/` (these folders are local data, not
part of the backend repository).
