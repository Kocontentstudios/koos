import { AwsClient } from "aws4fetch";
import { resolveImageConfig } from "./image-config";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} for image generation.`);
  return v;
}

// Stability text-to-image on Bedrock: request { prompt, mode, aspect_ratio, output_format };
// response { images: [base64], seeds, finish_reasons }. (Amazon Nova/Titan use a different
// taskType schema — this adapter targets the active Stability models. See spec §3.)
export async function generateBrandImage({
  prompt,
  aspectRatio = "1:1",
}: {
  prompt: string;
  aspectRatio?: string;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { model, region } = resolveImageConfig();
  // aws4fetch infers the SigV4 service from the request host, which would guess
  // "bedrock-runtime" — but Bedrock's actual signing name is "bedrock", so it
  // must be passed explicitly or every request gets SignatureDoesNotMatch.
  const aws = new AwsClient({
    accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
    ...(process.env.AWS_SESSION_TOKEN
      ? { sessionToken: process.env.AWS_SESSION_TOKEN }
      : {}),
    service: "bedrock",
    region,
  });
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/invoke`;
  const res = await aws.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      prompt,
      mode: "text-to-image",
      aspect_ratio: aspectRatio,
      output_format: "png",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Bedrock image generation failed (${res.status}): ${detail.slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { images?: string[] };
  const b64 = json.images?.[0];
  if (!b64) throw new Error("Bedrock returned no image.");
  return {
    bytes: Uint8Array.from(Buffer.from(b64, "base64")),
    contentType: "image/png",
  };
}
