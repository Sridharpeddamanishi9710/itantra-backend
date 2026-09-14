import { NextResponse } from "next/server";

export async function GET() {
  const manifest = {
    releaseVersion: "2026.09.1",
    timestamp: new Date().toISOString(),
    supportedDevices: ["Android", "iOS", "Tactical-Node"],
    models: [
      {
        modelId: "whisper-tiny-quantized",
        task: "STT",
        fileFormat: "ONNX",
        byteSize: 39500000,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        downloadUri: "/models/stt-whisper-tiny-q4.onnx",
      },
      {
        modelId: "piper-tts-compact",
        task: "TTS",
        fileFormat: "ONNX",
        byteSize: 18400000,
        sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
        downloadUri: "/models/tts-piper-compact.onnx",
      },
    ],
  };

  return NextResponse.json(manifest, { status: 200 });
}