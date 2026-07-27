"use client";

import { useRef } from "react";
import { GenerateImagePanel } from "./generate-image-panel";
import {
  QuickRequestForm,
  type QuickRequestFormHandle,
} from "./quick-request-form";

interface QuickRequestPanelProps {
  defaultBusinessName: string;
  defaultDeliveryEmail: string;
  /** Null for a user with no brand yet — "Generate with AI" needs a real
   * brandId, so it stays hidden until one exists (the form itself lazily
   * creates a draft brand once the user submits). */
  brandId: string | null;
}

/** Owns the ref bridge between the generate-image panel and the form: the
 * panel has no reason to know the form exists, so this is the one place
 * that wires its "use as reference" callback to the form's imperative
 * handle. */
export function QuickRequestPanel({
  defaultBusinessName,
  defaultDeliveryEmail,
  brandId,
}: QuickRequestPanelProps) {
  const formRef = useRef<QuickRequestFormHandle>(null);

  return (
    <div className="flex flex-col gap-6">
      {brandId && (
        <GenerateImagePanel
          brandId={brandId}
          onUseAsReference={(url) => formRef.current?.setReferenceImageUrl(url)}
        />
      )}
      <QuickRequestForm
        ref={formRef}
        defaultBusinessName={defaultBusinessName}
        defaultDeliveryEmail={defaultDeliveryEmail}
      />
    </div>
  );
}
