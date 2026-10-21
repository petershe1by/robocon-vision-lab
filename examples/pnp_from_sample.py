"""Read a browser-exported ZIP and estimate a single square face pose with OpenCV.

pip install numpy opencv-python
python pnp_from_sample.py path/to/vision_main_pnp_....zip --headless
python pnp_from_sample.py path/to/vision_main_sample_....zip --edge-mm 200
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from zipfile import ZipFile
import cv2
import numpy as np


def read_sample(filename: Path):
    with ZipFile(filename) as z:
        image = cv2.imdecode(np.frombuffer(z.read("image.png"), np.uint8), cv2.IMREAD_COLOR)
        camera = json.loads(z.read("camera_info.json"))
        points = json.loads(z.read("points.json")) if "points.json" in z.namelist() else None
    if image is None or image.shape[:2] != (camera["height"], camera["width"]):
        raise ValueError("Image resolution does not match camera_info.json")
    return image, camera, points


def pick_points(image):
    points = []
    window = "PnP: click TL, TR, BR, BL; Enter confirm; R reset; Esc cancel"
    def mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(points) < 4:
            points.append([float(x), float(y)])
    cv2.namedWindow(window)
    cv2.setMouseCallback(window, mouse)
    while True:
        view = image.copy()
        for i, p in enumerate(points):
            xy = tuple(map(int, p))
            cv2.circle(view, xy, 4, (0, 200, 255), -1)
            cv2.putText(view, str(i+1), (xy[0]+8, xy[1]-8), cv2.FONT_HERSHEY_SIMPLEX, .5, (0, 0, 0), 1)
        cv2.imshow(window, view)
        key = cv2.waitKey(20) & 255
        if key == 27:
            cv2.destroyAllWindows()
            raise KeyboardInterrupt("Point selection cancelled")
        if key in (ord('r'), ord('R')):
            points.clear()
        if key in (10, 13) and len(points) == 4:
            break
        if cv2.getWindowProperty(window, cv2.WND_PROP_VISIBLE) < 1:
            raise KeyboardInterrupt("Point selection window closed")
    cv2.destroyAllWindows()
    return np.asarray(points, dtype=np.float64)


def solve_square(object_points, image_points, K, D):
    if object_points.shape != (4, 3) or image_points.shape != (4, 2):
        raise ValueError("Expected four 3D points and four image points")
    area = abs(cv2.contourArea(image_points.astype(np.float32)))
    if area < 4:
        raise ValueError("Selected quadrilateral is degenerate or too small")
    ok, rvecs, tvecs, _ = cv2.solvePnPGeneric(
        object_points, image_points, K, D, flags=cv2.SOLVEPNP_IPPE_SQUARE)
    candidates = []
    if ok:
        for rvec, tvec in zip(rvecs, tvecs):
            rotation, _ = cv2.Rodrigues(rvec)
            camera_points = (rotation @ object_points.T + tvec).T
            if np.any(camera_points[:, 2] <= 0):
                continue
            projected, _ = cv2.projectPoints(object_points, rvec, tvec, K, D)
            error = float(np.sqrt(np.mean(np.sum((projected[:, 0]-image_points)**2, axis=1))))
            candidates.append((error, rvec, tvec))
    if not candidates:
        raise RuntimeError("No positive-depth PnP candidate")
    return sorted(candidates, key=lambda c: c[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path)
    parser.add_argument("--edge-mm", type=float, help="Real edge length of the clicked square face")
    parser.add_argument("--headless", action="store_true", help="Requires exported points.json")
    args = parser.parse_args()
    image, camera, stored = read_sample(args.sample)
    K = np.asarray(camera["camera_matrix"], dtype=np.float64)
    D = np.asarray(camera["distortion_coefficients"], dtype=np.float64)
    if stored:
        image_points = np.asarray(stored["image_points_px"], dtype=np.float64)
        object_points = np.asarray(stored["object_points_m"], dtype=np.float64)
    else:
        if args.headless:
            parser.error("--headless needs points.json; export an angle-point ZIP from the simulator")
        if args.edge_mm is None or args.edge_mm <= 0:
            parser.error("Specify --edge-mm 200 or --edge-mm 350 to match the clicked object")
        image_points = pick_points(image)
        h = args.edge_mm / 2000
        object_points = np.asarray([[-h,h,0],[h,h,0],[h,-h,0],[-h,-h,0]], dtype=np.float64)
    candidates = solve_square(object_points, image_points, K, D)
    error, rvec, tvec = candidates[0]
    result = {
        "origin": "clicked_square_face_center", "frame": "camera_optical",
        "axes": "X right, Y down, Z forward", "units": "m",
        "translation_m": tvec[:, 0].tolist(), "rvec_rad": rvec[:, 0].tolist(),
        "z_depth_m": float(tvec[2, 0]), "euclidean_distance_m": float(np.linalg.norm(tvec)),
        "reprojection_rms_px": error, "positive_depth_candidates": len(candidates),
        "note": "Planar square orientation may be ambiguous. This is face center, not cube center."
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not args.headless:
        cv2.drawFrameAxes(image, K, D, rvec, tvec, float(np.linalg.norm(object_points[0]))*.6)
        cv2.imshow("PnP result", image)
        cv2.waitKey(0)
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
