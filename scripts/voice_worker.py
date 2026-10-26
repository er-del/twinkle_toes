"""Keep a text-to-speech engine loaded and synthesize one line per JSON request.

Reads newline-delimited JSON from stdin: {"id": "...", "text": "...", "path": "..."}
Writes one JSON acknowledgement per request to stdout.
"""

import json
import os
import pathlib
import sys
import wave

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

backend = sys.argv[1]

if backend == "piper":
    from piper import PiperVoice, SynthesisConfig

    voice = PiperVoice.load(sys.argv[2])
    synthesis = SynthesisConfig(length_scale=0.94)

    def synthesize(text, output_path, _language):
        with wave.open(str(output_path), "wb") as wav_file:
            voice.synthesize_wav(text, wav_file, syn_config=synthesis)
elif backend == "nvidia":
    import riva.client

    voices = {
        "en": ("en-US", os.environ.get("NVIDIA_VOICE_EN", "Chatterbox-Multilingual.en-US.Male")),
        "hi": ("hi-IN", os.environ.get("NVIDIA_VOICE_HI", "Chatterbox-Multilingual.hi-IN.Male")),
    }

    def get_service(api_key):
        if not api_key:
            raise RuntimeError("NVIDIA_VOICE_API_KEY or NVIDIA_API_KEY is required.")
        auth = riva.client.Auth(
            uri=os.environ.get("NVIDIA_VOICE_SERVER", "grpc.nvcf.nvidia.com:443"),
            use_ssl=True,
            metadata_args=[
                ("function-id", os.environ.get("NVIDIA_VOICE_FUNCTION_ID", "ddacc747-1269-4fab-bfd9-8f593dead106")),
                ("authorization", f"Bearer {api_key}"),
            ],
        )
        return riva.client.SpeechSynthesisService(auth)

    def synthesize(text, output_path, language, api_key):
        locale, voice_name = voices.get(language, voices["en"])
        service = get_service(api_key or os.environ.get("NVIDIA_VOICE_API_KEY") or os.environ.get("NVIDIA_API_KEY"))
        response = service.synthesize(text, voice_name, locale, sample_rate_hz=22050)
        if not response.audio:
            raise RuntimeError("NVIDIA Chatterbox returned empty audio.")
        with wave.open(str(output_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(22050)
            wav_file.writeframes(response.audio)
else:
    raise RuntimeError(f"Unknown voice backend: {backend}")

print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    request = {}
    try:
        request = json.loads(line)
        output_path = pathlib.Path(request["path"])
        if backend == "nvidia":
            synthesize(request["text"], output_path, request.get("language", "en"), request.get("apiKey", ""))
        else:
            synthesize(request["text"], output_path, request.get("language", "en"))
        result = {"id": request.get("id"), "ok": True}
    except Exception as error:
        result = {"id": request.get("id"), "ok": False, "error": str(error)}

    print(json.dumps(result), flush=True)
