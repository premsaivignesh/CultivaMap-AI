"""Regenerate the synthetic demo dataset:  python backend/scripts/generate_sample_data.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.ml.sample import write_sample  # noqa: E402

out = Path(__file__).resolve().parents[1] / "data"
n = write_sample(out)
print(f"Created {n} synthetic observations + terrace polygons in {out}")
print("Reminder: synthetic values are NOT field observations.")
