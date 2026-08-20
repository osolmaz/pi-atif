#!/usr/bin/env python3

import json
import sys
from pathlib import Path

harbor_root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(harbor_root / "src"))

import pydantic  # noqa: E402
from harbor.models.trajectories import Trajectory  # noqa: E402
from harbor.utils.trajectory_validator import TrajectoryValidator  # noqa: E402

paths = [Path(value).resolve() for value in sys.argv[2:]]
if not paths:
    raise SystemExit("No ATIF files supplied")

for path in paths:
    data = json.loads(path.read_text(encoding="utf-8"))
    trajectory = Trajectory.model_validate(data)
    validator = TrajectoryValidator()
    if not validator.validate(path, validate_images=False):
        raise SystemExit(f"{path}: {'; '.join(validator.get_errors())}")
    round_trip = trajectory.to_json_dict()
    Trajectory.model_validate(round_trip)
    if round_trip != data:
        raise SystemExit(f"{path}: Harbor round-trip changed the trajectory")
    print(f"validated {path}")

print(f"Harbor commit: {harbor_root.name}")
print(f"Pydantic version: {pydantic.__version__}")
