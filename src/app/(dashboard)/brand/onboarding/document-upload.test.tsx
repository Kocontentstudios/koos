import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadToPresignedUrl = vi.fn();
vi.mock("@/lib/uploads/put-presigned", () => ({
  uploadToPresignedUrl: (...a: unknown[]) => uploadToPresignedUrl(...a),
}));
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => toastError(m),
    info: (m: string) => toastInfo(m),
    success: vi.fn(),
  },
}));

import type { Proposal } from "@/lib/ai/tools/proposals";
import {
  DocumentInput,
  DocumentUploadButton,
  DocumentUploadStatus,
  useDocumentUpload,
} from "./document-upload";

const onProposal = vi.fn();
const conversation = vi.fn(() => "user: We are Okra Kitchen.");

function Harness() {
  const upload = useDocumentUpload({
    brandId: "b1",
    conversation,
    onProposal,
  });
  return (
    <div>
      <DocumentInput inputRef={upload.inputRef} onChange={upload.onChange} />
      <DocumentUploadButton
        onClick={upload.open}
        busy={upload.busy}
        statusId="status"
      />
      <DocumentUploadStatus
        id="status"
        stage={upload.stage}
        fileName={upload.fileName}
        percent={upload.percent}
      />
    </div>
  );
}

const PROPOSAL: Proposal = {
  kind: "brand_fields",
  summary: "Okra Kitchen",
  data: { fields: { name: "Okra Kitchen" } },
};

function pdf(name = "guidelines.pdf") {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

function pick(file: File) {
  const input = screen.getByTestId("document-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  uploadToPresignedUrl.mockResolvedValue(undefined);
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("presign")) {
      return new Response(
        JSON.stringify({ key: "brand-docs/u1/abc.pdf", url: "https://put" }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ proposal: PROPOSAL }), {
      status: 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const bodyOf = (call: unknown[]) =>
  JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;

describe("the presign request", () => {
  /* kind:"document" is what routes the upload to the brand-docs prefix. Sent
     as an attachment it lands under reference-images, and the parse route —
     which pins the document prefix — then refuses the user's own file. */
  it("asks for a document, not an attachment", async () => {
    render(<Harness />);
    pick(pdf());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock.mock.calls[0]).kind).toBe("document");
  });

  it("sends the real name, type and size", async () => {
    render(<Harness />);
    pick(pdf("Brand Guidelines.pdf"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.fileName).toBe("Brand Guidelines.pdf");
    expect(body.mimeType).toBe("application/pdf");
    expect(body.sizeBytes).toBeGreaterThan(0);
  });
});

describe("the parse request", () => {
  it("sends the key the presign step returned, never a URL", async () => {
    render(<Harness />);
    pick(pdf());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = bodyOf(fetchMock.mock.calls[1]);
    expect(body.key).toBe("brand-docs/u1/abc.pdf");
    expect(body).not.toHaveProperty("url");
  });

  /* The document is read ALONGSIDE what the user has already typed, not
     instead of it. */
  it("carries the conversation so far", async () => {
    render(<Harness />);
    pick(pdf());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock.mock.calls[1]).conversation).toContain(
      "Okra Kitchen",
    );
  });

  it("hands the proposal back rather than writing anything", async () => {
    render(<Harness />);
    pick(pdf());
    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    expect(onProposal).toHaveBeenCalledWith(PROPOSAL, "guidelines.pdf");
  });
});

describe("choosing the same file twice", () => {
  /* A file input fires no change event when the same file is picked again, so
     the value has to be cleared — otherwise a user whose first attempt failed
     cannot retry with that file at all. */
  it("clears the input so a repeat pick still fires", async () => {
    render(<Harness />);
    const input = pick(pdf());
    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    expect(input.value).toBe("");
  });

  it("clears the input after a failure too", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
    );
    render(<Harness />);
    const input = pick(pdf());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(input.value).toBe("");
  });
});

describe("what the user is told while waiting", () => {
  it("announces the upload in a live region", async () => {
    let resolveUpload: (() => void) | undefined;
    uploadToPresignedUrl.mockImplementation(
      (_url, _file, onProgress: (f: number) => void) =>
        new Promise<void>((resolve) => {
          onProgress(0.42);
          resolveUpload = resolve;
        }),
    );
    render(<Harness />);
    pick(pdf());
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/uploading guidelines\.pdf/i);
    expect(status.textContent).toContain("42%");
    /* Never aria-busy on a live region: it tells assistive tech to withhold
       the very update the region exists to deliver. */
    expect(status).not.toHaveAttribute("aria-busy");
    resolveUpload?.();
  });

  it("says it is reading once the bytes are up", async () => {
    let resolveParse: ((r: Response) => void) | undefined;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("presign")) {
        return new Response(
          JSON.stringify({ key: "brand-docs/u1/abc.pdf", url: "https://put" }),
          { status: 200 },
        );
      }
      return new Promise<Response>((resolve) => {
        resolveParse = resolve;
      });
    });
    render(<Harness />);
    pick(pdf());
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/reading/i),
    );
    resolveParse?.(
      new Response(JSON.stringify({ proposal: PROPOSAL }), { status: 200 }),
    );
  });

  it("disables the button while it is working", async () => {
    uploadToPresignedUrl.mockImplementation(() => new Promise(() => {}));
    render(<Harness />);
    pick(pdf());
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /reading/i });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
    });
  });

  it("shows nothing at rest", () => {
    render(<Harness />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("when something goes wrong", () => {
  it("surfaces the server's reason, not a generic message", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("presign")
        ? new Response(
            JSON.stringify({ key: "brand-docs/u1/a.pdf", url: "https://put" }),
            { status: 200 },
          )
        : new Response(
            JSON.stringify({
              error: "That file has no readable text — it may be a scan.",
            }),
            { status: 422 },
          ),
    );
    render(<Harness />);
    pick(pdf());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/no readable text/i);
    expect(onProposal).not.toHaveBeenCalled();
  });

  it("recovers to idle so another file can be tried", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
    );
    render(<Harness />);
    pick(pdf());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("button", { name: /attach a brand document/i }),
    ).not.toBeDisabled();
  });

  /* A deck read only in part may be missing what was at the end of it, and the
     user is about to confirm the result. */
  it("warns when only part of the document was read", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("presign")
        ? new Response(
            JSON.stringify({ key: "brand-docs/u1/a.pdf", url: "https://put" }),
            { status: 200 },
          )
        : new Response(
            JSON.stringify({ proposal: PROPOSAL, truncated: true }),
            { status: 200 },
          ),
    );
    render(<Harness />);
    pick(pdf());
    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    expect(toastInfo.mock.calls[0][0]).toMatch(/beginning of it/i);
  });

  it("says nothing about truncation for a document read whole", async () => {
    render(<Harness />);
    pick(pdf());
    await waitFor(() => expect(onProposal).toHaveBeenCalled());
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
