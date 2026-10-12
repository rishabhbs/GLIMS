import { InstructionsEditor } from "./InstructionsEditor";
import { LabFactsEditor } from "./LabFactsEditor";
import { AudienceEditor } from "./AudienceEditor";

export default function AdminPage() {
  return (
    <div>
      <h1>Admin</h1>
      <p className="lead">The Studio&apos;s writing policy and knowledge: base instructions, real-world facts, and audience.</p>

      <InstructionsEditor />

      <div style={{ marginTop: "var(--space-2xl)" }}>
        <LabFactsEditor />
      </div>

      <div style={{ marginTop: "var(--space-2xl)" }}>
        <AudienceEditor />
      </div>

      <div className="notice" style={{ marginTop: "var(--space-lg)" }}>
        Product-knowledge corrections flow into the Brain&apos;s real knowledge graph. Job queue and correction review/revert arrive in M2/M4.
      </div>
    </div>
  );
}
