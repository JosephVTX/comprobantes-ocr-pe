import sys

import cv2
import numpy as np

from app import leer

img = cv2.imdecode(np.frombuffer(sys.stdin.buffer.read(), np.uint8), cv2.IMREAD_COLOR)
print("\n".join(leer(img)))
