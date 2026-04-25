import argparse

import numpy as np
from PIL import Image


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--quality", type=int, default=95)
    parser.add_argument("--gain-r", type=float, default=1.0)
    parser.add_argument("--gain-g", type=float, default=1.0)
    parser.add_argument("--gain-b", type=float, default=1.0)
    parser.add_argument("--exposure", type=float, default=1.0)
    parser.add_argument("--gamma", type=float, default=1.0)
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGB")
    array = np.asarray(image, dtype=np.float32) / 255.0

    array[:, :, 0] *= args.gain_r
    array[:, :, 1] *= args.gain_g
    array[:, :, 2] *= args.gain_b
    array = np.clip(array * args.exposure, 0.0, 1.0)
    array = np.clip(np.power(array, args.gamma), 0.0, 1.0)

    output = Image.fromarray(np.clip(array * 255.0, 0, 255).astype(np.uint8), mode="RGB")
    output.save(args.output, quality=max(1, min(100, args.quality)), subsampling=0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
