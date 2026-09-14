import { NextResponse } from "next/server";

export interface TacticalModel {
  id: string;
  name: string;
  version: string;
  type: "STT" | "TTS" | "TACTICAL_NLP" | "VISION";
  framework: "ONNX" | "TFLITE" | "GGUF";
  fileSizeBytes: number;
  sha256: string;
  downloadUrl: string;
  isEdgeOptimized: boolean;
}

const AI_MODEL_REGISTRY: TacticalModel[] = [
  {
    id: "whisper-base-tactical-onnx",
    name: "Tactical Speech-to-Text (Whisper Base)",
    version: "1.2.0",
    type: "STT",
    framework: "ONNX",
    fileSizeBytes: 74500000, // ~74.5 MB
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    downloadUrl: "/api/v1/models/download/whisper-base-tactical-onnx",
    isEdgeOptimized: true,
  },
  {
    id: "piper-tactical-voice-onnx",
    name: "Tactical Voice Dispatch TTS",
    version: "1.0.4",
    type: "TTS",
    framework: "ONNX",
    fileSizeBytes: 31200000, // ~31.2 MB
    sha256: "d5a84e27f6e3529944a9042dd15949d21e25e98544d6735e297ee4c4d5d9c100",
    downloadUrl: "/api/v1/models/download/piper-tactical-voice-onnx",
    isEdgeOptimized: true,
  },
  {
    id: "intent-classifier-gguf",
    name: "Tactical Keyword & Intent Classifier",
    version: "2.1.0",
    type: "TACTICAL_NLP",
    framework: "GGUF",
    fileSizeBytes: 18400000, // ~18.4 MB
    sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    downloadUrl: "/api/v1/models/download/intent-classifier-gguf",
    isEdgeOptimized: true,
  },
];

export async function GET() {
  return NextResponse.json(
    {
      success: true,
      totalModels: AI_MODEL_REGISTRY.length,
      models: AI_MODEL_REGISTRY,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}