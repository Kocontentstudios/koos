import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import type { ImageModel, LanguageModel } from "ai";

export type GoogleEnv = Record<string, string | undefined>;

export type GoogleTransport = "vertex" | "ai-studio";

/** The Gemini 3 line resolves only on the global endpoint; every regional host
 * returns 404 for it. */
const DEFAULT_VERTEX_LOCATION = "global";

export function isVertexConfigured(env: GoogleEnv = process.env): boolean {
  return Boolean(
    env.GOOGLE_VERTEX_PROJECT &&
      env.GOOGLE_CLIENT_EMAIL &&
      env.GOOGLE_PRIVATE_KEY,
  );
}

export function isGoogleConfigured(env: GoogleEnv = process.env): boolean {
  return isVertexConfigured(env) || Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY);
}

/**
 * Vertex wins whenever both are configured. Google excluded the AI Studio
 * endpoint from Cloud trial credits for accounts opened after 2026-03-02, so
 * the two surfaces serve identical models at identical prices but only Vertex
 * draws the credit.
 */
export function activeGoogleTransport(
  env: GoogleEnv = process.env,
): GoogleTransport | null {
  if (isVertexConfigured(env)) return "vertex";
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) return "ai-studio";
  return null;
}

function vertexProvider(env: GoogleEnv) {
  return createVertex({
    project: env.GOOGLE_VERTEX_PROJECT as string,
    location: env.GOOGLE_VERTEX_LOCATION || DEFAULT_VERTEX_LOCATION,
    googleAuthOptions: {
      credentials: {
        client_email: env.GOOGLE_CLIENT_EMAIL as string,
        // Vercel stores the PEM with escaped newlines; the JWT signer rejects
        // it unless they are expanded back to real line breaks.
        private_key: (env.GOOGLE_PRIVATE_KEY as string).replace(/\\n/g, "\n"),
      },
    },
  });
}

function aiStudioProvider(env: GoogleEnv) {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Google is not configured. Set GOOGLE_VERTEX_PROJECT / GOOGLE_CLIENT_EMAIL / " +
        "GOOGLE_PRIVATE_KEY for Vertex, or GOOGLE_GENERATIVE_AI_API_KEY for AI Studio.",
    );
  }
  return createGoogleGenerativeAI({ apiKey });
}

export function googleLanguageModel(
  model: string,
  env: GoogleEnv = process.env,
): LanguageModel {
  return isVertexConfigured(env)
    ? vertexProvider(env)(model)
    : aiStudioProvider(env)(model);
}

export function googleImageModel(
  model: string,
  env: GoogleEnv = process.env,
): ImageModel {
  return isVertexConfigured(env)
    ? vertexProvider(env).image(model)
    : aiStudioProvider(env).image(model);
}
