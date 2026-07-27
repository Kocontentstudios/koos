import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerateImagePanel } from "./generate-image-panel";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const GENERATED_URL = "https://cdn.example.com/generated/abc123.png";
const GENERATED_KEY = `generated/${BRAND_ID}/abc123.png`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubSuccessfulGenerate() {
  return stubFetch(async (url) => {
    if (url === "/api/design/generate-image") {
      return new Response(
        JSON.stringify({
          url: GENERATED_URL,
          key: GENERATED_KEY,
          contentType: "image/png",
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ asset: { id: "asset-1" } }), {
      status: 200,
    });
  });
}

async function generateAndFillPrompt() {
  fireEvent.change(screen.getByLabelText(/describe the image/i), {
    target: { value: "a warm flat-lay of sourdough loaves" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
  await waitFor(() =>
    expect(screen.getByAltText(/ai-generated draft/i)).toBeInTheDocument(),
  );
}

describe("GenerateImagePanel", () => {
  it("posts brandId and prompt to the generate-image endpoint", async () => {
    const fetchMock = stubSuccessfulGenerate();
    render(
      <GenerateImagePanel brandId={BRAND_ID} onUseAsReference={vi.fn()} />,
    );

    await generateAndFillPrompt();

    const call = fetchMock.mock.calls.find(
      ([url]) => url === "/api/design/generate-image",
    );
    expect(call).toBeTruthy();
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body.brandId).toBe(BRAND_ID);
    expect(body.prompt).toBe("a warm flat-lay of sourdough loaves");
  });

  it("shows the preview and the three actions once generation succeeds", async () => {
    stubSuccessfulGenerate();
    render(
      <GenerateImagePanel brandId={BRAND_ID} onUseAsReference={vi.fn()} />,
    );

    await generateAndFillPrompt();

    expect(screen.getByAltText(/ai-generated draft/i)).toHaveAttribute(
      "src",
      GENERATED_URL,
    );
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      GENERATED_URL,
    );
    expect(
      screen.getByRole("button", { name: /save as brand asset/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use as reference/i }),
    ).toBeInTheDocument();
  });

  it("calls onUseAsReference with the returned url", async () => {
    stubSuccessfulGenerate();
    const onUseAsReference = vi.fn();
    render(
      <GenerateImagePanel
        brandId={BRAND_ID}
        onUseAsReference={onUseAsReference}
      />,
    );

    await generateAndFillPrompt();
    fireEvent.click(screen.getByRole("button", { name: /use as reference/i }));

    expect(onUseAsReference).toHaveBeenCalledWith(GENERATED_URL);
  });

  it("posts the returned key to save-asset when saving as a brand asset", async () => {
    const fetchMock = stubSuccessfulGenerate();
    render(
      <GenerateImagePanel brandId={BRAND_ID} onUseAsReference={vi.fn()} />,
    );

    await generateAndFillPrompt();
    fireEvent.click(
      screen.getByRole("button", { name: /save as brand asset/i }),
    );

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => url === "/api/design/generated/save-asset",
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call?.[1] as RequestInit).body as string);
      expect(body.brandId).toBe(BRAND_ID);
      expect(body.key).toBe(GENERATED_KEY);
    });
  });

  it("shows an error toast and no preview when generation fails", async () => {
    const { toast } = await import("sonner");
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: "Image generation failed" }), {
          status: 500,
        }),
    );
    render(
      <GenerateImagePanel brandId={BRAND_ID} onUseAsReference={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText(/describe the image/i), {
      target: { value: "a warm flat-lay of sourdough loaves" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Image generation failed"),
    );
    expect(
      screen.queryByAltText(/ai-generated draft/i),
    ).not.toBeInTheDocument();
  });
});
