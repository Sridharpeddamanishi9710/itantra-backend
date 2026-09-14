import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Check for MinIO / S3 Storage Redirect (Production / Staging)
  const storageEndpoint = process.env.S3_STORAGE_ENDPOINT;
  if (storageEndpoint) {
    return NextResponse.redirect(`${storageEndpoint}/${id}`, 307);
  }

  // 2. Check local disk storage: inspect both .onnx and .gguf extensions
  const storageDir = path.join(process.cwd(), "models-storage");
  const candidates = [
    path.join(storageDir, id),
    path.join(storageDir, `${id}.onnx`),
    path.join(storageDir, `${id}.gguf`),
  ];

  let resolvedPath: string | null = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      resolvedPath = candidate;
      break;
    }
  }

  if (resolvedPath) {
    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;
    const range = req.headers.get("range");

    // Handle byte-range request for resumable mobile downloads
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      const fileStream = fs.createReadStream(resolvedPath, { start, end });
      const stream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk) => controller.enqueue(chunk));
          fileStream.on("end", () => controller.close());
          fileStream.on("error", (err) => controller.error(err));
        },
      });

      return new NextResponse(stream as any, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize.toString(),
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${path.basename(resolvedPath)}"`,
        },
      });
    }

    // Direct stream full file
    const fileBuffer = fs.readFileSync(resolvedPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Length": fileSize.toString(),
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${path.basename(resolvedPath)}"`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  // 3. Clear report if neither external S3 nor local disk artifact is staged
  return NextResponse.json(
    {
      success: false,
      error: "STORAGE_NOT_CONFIGURED",
      message: `Model artifact for '${id}' is not staged. Set S3_STORAGE_ENDPOINT or place file in apps/c2-portal/models-storage/${id}.onnx (or .gguf)`,
    },
    { status: 503 }
  );
}