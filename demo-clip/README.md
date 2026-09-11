# Local query clips

Put short audio clips here for the local teaching/demo recognizer. These files are local inputs and
are ignored by Git; do not commit copyrighted audio.

From `backend/`, recognize a clip by filename:

```bash
python -m app.demo "your-clip.wav"
```

The browser recognizer uses the same signal services through `POST /recognize` and does not require
placing its temporary microphone recording in this directory.
