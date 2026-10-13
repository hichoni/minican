# 배경 제거 모델

- `u2netp.onnx` — U²-Net (작은 판, 320×320 입력, 약 4.4MB). 사진에서 "주인공"(사람 · 동물 · 사물)을 찾는다.
  - 출처: Qin et al., "U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection" (2020), https://github.com/xuebinqin/U-2-Net — **Apache License 2.0**.
  - 파일: rembg 의 공개 배포본(https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx), md5 `8e83ca70e441ab06c318d82300c84806`.
- 실행: onnxruntime-web(MIT)을 jsDelivr 에서 고정 판(1.29.0)으로 불러와 브라우저 안에서만 돌린다. 사진은 기기 밖으로 나가지 않는다.
- 쓰는 곳: `src/segment.js`(불러오기 · 추론), 다듬기는 `cutout.js` 의 `refineCutout`.

- 라이선스 전문: 같은 폴더의 `LICENSE-U2Net.txt` (Apache License 2.0).
