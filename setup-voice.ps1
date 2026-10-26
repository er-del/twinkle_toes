$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $Root ".venv-tts\Scripts\python.exe"
$VoiceDirectory = Join-Path $Root "voice-models"

if (-not (Test-Path $VenvPython)) {
    python -m venv (Join-Path $Root ".venv-tts")
    if ($LASTEXITCODE -ne 0) { throw "Could not create the local TTS Python environment." }
}

& $VenvPython -m pip install -r (Join-Path $Root "requirements-voice.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not install the voice dependencies." }

& $VenvPython -m piper.download_voices --data-dir $VoiceDirectory en_US-amy-medium
if ($LASTEXITCODE -ne 0) { throw "Could not download the Amy English voice model." }

Write-Output "NVIDIA Chatterbox client and local Amy fallback are ready. Restart the Twinkle Toes server."
