from __future__ import annotations

import argparse
import time
import winsound
from pathlib import Path

import numpy as np
import pythoncom
import sounddevice as sd
import win32com.client
from scipy.io.wavfile import write


def speak(text: str) -> None:
    pythoncom.CoInitialize()
    try:
        voice = win32com.client.Dispatch("SAPI.SpVoice")
        voice.Rate = 0
        voice.Volume = 100
        voice.Speak(text)
    finally:
        pythoncom.CoUninitialize()


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture a bounded microphone sample to PCM WAV")
    parser.add_argument("output", type=Path)
    parser.add_argument("--seconds", type=float, default=6.0)
    parser.add_argument("--device-hint", default="JBL")
    parser.add_argument(
        "--prompt",
        default="Recording will start after the tone. Say: Approve once for this Codex request.",
    )
    args = parser.parse_args()

    candidates = [
        (index, device)
        for index, device in enumerate(sd.query_devices())
        if int(device.get("max_input_channels", 0)) > 0
        and args.device_hint.casefold() in str(device.get("name", "")).casefold()
    ]
    if not candidates:
        raise RuntimeError(f"No input device matched {args.device_hint!r}")

    device_index, device = candidates[0]
    sample_rate = int(round(float(device["default_samplerate"])))
    frames = int(sample_rate * max(1.0, min(args.seconds, 15.0)))

    speak(args.prompt)
    winsound.Beep(1100, 500)
    time.sleep(0.25)
    audio = sd.rec(
        frames,
        samplerate=sample_rate,
        channels=1,
        dtype="float32",
        device=device_index,
    )
    sd.wait()

    mono = np.clip(audio[:, 0], -1.0, 1.0)
    pcm = (mono * 32767.0).astype(np.int16)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write(args.output, sample_rate, pcm)

    rms = float(np.sqrt(np.mean(np.square(mono), dtype=np.float64)))
    peak = float(np.max(np.abs(mono)))
    print(
        f"captured={args.output} device={device_index}:{device['name']} "
        f"sample_rate={sample_rate} seconds={args.seconds:.1f} rms={rms:.6f} peak={peak:.6f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
