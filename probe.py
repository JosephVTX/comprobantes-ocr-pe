import sys

import cv2
import numpy as np

from app import get_ocr

img = cv2.imdecode(np.frombuffer(sys.stdin.buffer.read(), np.uint8), cv2.IMREAD_COLOR)
for r in get_ocr().predict(img):
    print("\n".join(r["rec_texts"]))
