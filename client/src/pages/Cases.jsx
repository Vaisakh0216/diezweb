import React, { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api, qs, exportCSV } from "../api.js";
import { useAuth, useMeta, useToast } from "../context.jsx";
import { Modal } from "../components/ui.jsx";
import { Remarks, RemarkCount, fmtStamp } from "../components/WorkTable.jsx";
import { CASE_MODULES } from "../components/Layout.jsx";
import { ORG } from "../org.js";

/** Tell the sidebar to refresh its case counters */
export const notifyCasesChanged = () =>
  window.dispatchEvent(new Event("cases:changed"));

const STATUS_CLS = {
  "Under Review": "progress",
  "Requested Further Documents": "pending",
  Possible: "pending",
  "Escalate to Manager": "admin",
  "True Match": "leave",
  False: "done",
};
const Badge = ({ v }) =>
  v ? (
    <span className={`badge ${STATUS_CLS[v] || ""}`}>{v}</span>
  ) : (
    <span className="muted">—</span>
  );
// Action plan for a True Match: one of the case menus, or close with no further action
const NFA = { slug: "no-further-action", name: "No further action" };
// Action plans for a True Match. Red Flag is not one: it lists every True Match whose action plan is not SAR.
const RED_FLAG = "red-flag";
const ACTION_PLANS = [...CASE_MODULES.filter((m) => m.slug !== RED_FLAG), NFA];
const isRedFlag = (u, meta) => u.status === meta.trueMatch && u.module !== "sar";
const moduleName = (slug) => ACTION_PLANS.find((m) => m.slug === slug)?.name;
const fmtDay = (s) => (s ? fmtStamp(s).split(",")[0] : "");

/* Escalation / hold notes shown under the status */
function StatusNotes({ c, meta }) {
  const escalated = c.status === meta.escalate && c.escalated_to;
  const decidedAfterEscalation =
    c.escalated_at && meta.decisionStatuses.includes(c.status);
  return (
    <>
      {escalated &&
        (c.esc_manager_rec ? (
          <div className="cell-note ok">
            ✓ {c.esc_manager_by_name}:{" "}
            {recText(meta, c.esc_manager_rec, c.esc_manager_rec_other)} · set
            True Match / False
          </div>
        ) : (
          <div className="cell-note warn">
            ↑ {c.escalated_name} · {fmtDay(c.escalated_at)} · awaiting manager
          </div>
        ))}
      {c.status === meta.possible && (
        <div className="cell-note warn">⏸ On hold until True Match / False</div>
      )}
      {decidedAfterEscalation && (
        <div className="cell-note">
          ✓ Decided after escalation to {c.escalated_name}
        </div>
      )}
    </>
  );
}

/* ---------- officer review form (every field mandatory) ---------- */
/** BU from the Service Request prefix, e.g. DSO-LIC-225856 -> DSO */
export const guessBu = (meta, requestNo) =>
  meta.bus.find((b) => String(requestNo).toUpperCase().startsWith(`${b}-`)) ||
  "";
export const recText = (meta, rec, other) =>
  rec === meta.others && other ? `Others: ${other}` : rec;

/* ---------- inspection team notification (part of the escalation report) ---------- */
const todayLabel = () =>
  new Date().toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
const notifySubject = (c) =>
  `Escalated to manager: ${c.company} (${c.request_no})`;
function buildNotifyTemplate({
  date,
  bu,
  company,
  request_no,
  alert_category,
  details,
  investigator,
}) {
  return [
    "Dear Manager,",
    "",
    "Please note that the following case has been escalated to management for review.",
    "",
    `Date: ${date}`,
    `BU: ${bu || "—"}`,
    `Company name: ${company}`,
    `Service Request: ${request_no}`,
    `Alert Category: ${alert_category || "—"}`,
    `Crime/alert details: ${details || "—"}`,
    `Investigator: ${investigator}`,
    "",
    `Kindly arrange the necessary inspection and keep the ${ORG.department} team informed of any findings.`,
    "",
    "Regards,",
    investigator,
    `${ORG.department} Department, ${ORG.company}`,
  ].join("\n");
}

/** Copy the notification, or open it in the user's mail app */
function NotifyActions({ subject, body }) {
  const meta = useMeta();
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      toast("Notification copied");
    } catch {
      toast("Could not copy: select the text and copy it manually", "error");
    }
  };
  const mail = `mailto:${encodeURIComponent(
    meta.inspectionEmail || ""
  )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" className="btn btn-sm" onClick={copy}>
        Copy
      </button>
      <a className="btn btn-sm" href={mail} id="btn-hm-email">
        Open in email
      </a>
    </div>
  );
}

function ReviewModal({ c, managers, onClose, onSaved }) {
  const meta = useMeta();
  const { user } = useAuth();
  const [f, setF] = useState({
    app_type: c.app_type || "",
    bu: c.bu || guessBu(meta, c.request_no),
    wc_reference: c.wc_reference || "",
    matched_party: c.matched_party || "",
    alert_category: c.alert_category || "",
    status: c.status || "Under Review",
    false_reason: c.false_reason || "",
    escalated_to: c.escalated_to ? String(c.escalated_to) : "",
    module: c.module || "",
    nfa_reason: c.nfa_reason || "",
  });
  // officer's recommendation for the manager (pre-filled from an open escalation); everything else is auto-populated
  const openEsc = c.status === meta.escalate && c.esc_id && !c.esc_decided_at;
  const [esc, setEsc] = useState({
    findings: (openEsc && c.esc_findings) || "",
    notify_template: (openEsc && c.esc_template) || "",
    investigator_rec: (openEsc && c.esc_investigator_rec) || "",
    investigator_rec_other: (openEsc && c.esc_investigator_rec_other) || "",
  });
  const setE = (k) => (e) => setEsc({ ...esc, [k]: e.target.value });
  // Manager mode: an admin opens a case escalated to a manager. The officer's form is shown locked;
  // only the manager recommendation can be entered.
  const managerMode =
    user.role === "admin" && !!openEsc && c.assigned_to !== user.id;
  const [mg, setMg] = useState({
    manager_rec: c.esc_manager_rec || "",
    manager_rec_other: c.esc_manager_rec_other || "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Possible -> False / Escalate to Manager · Escalate to Manager -> False (or the True Match checkbox) after the manager recommends.
  // True Match is never in the list: it is the checkbox below.
  const TM = meta.trueMatch;
  const next = meta.nextStatuses[c.status];
  const statusOptions = (
    c.status === meta.escalate
      ? c.esc_manager_rec
        ? meta.caseStatuses.filter((s) => s === meta.escalate || s === "False")
        : [meta.escalate]
      : next
      ? meta.caseStatuses.filter((s) => s === c.status || next.includes(s))
      : meta.caseStatuses
  ).filter((s) => s !== TM);
  const tmAllowed =
    (c.status === meta.escalate && !!c.esc_manager_rec) || c.status === TM;
  const isTM = f.status === TM;
  const setTM = (on) =>
    setF({
      ...f,
      status: on ? TM : c.status !== TM ? c.status : statusOptions[0],
      // a True Match goes to Red Flag unless the officer picks another action plan
      ...(on ? { module: ACTION_PLANS.some((p) => p.slug === f.module) ? f.module : "" } : { module: c.status === TM ? "" : c.module || "" }),
    });
  const isNFA = isTM && f.module === NFA.slug;
  const needReason = f.status === "False";
  const needManager = f.status === meta.escalate;

  const missingOfficer = [
    ["app_type", "Application Type"],
    ["bu", "BU"],
    ["wc_reference", "World-Check Reference"],
    ["matched_party", "Matched Individual/Company"],
    ["alert_category", "Alert Category"],
    ["status", "Status"],
  ]
    .filter(([k]) => !String(f[k]).trim())
    .map(([, l]) => l);
  if (needReason && !f.false_reason.trim()) missingOfficer.push("Reason for False");
  if (isTM && !f.module) missingOfficer.push("Action plan");
  if (isNFA && !f.nfa_reason.trim())
    missingOfficer.push("Reason for no further action");
  if (needManager && !f.escalated_to) missingOfficer.push("Escalated to");
  if (needManager && !esc.findings.trim()) missingOfficer.push("Crime/alert details");
  if (needManager && !esc.notify_template.trim())
    missingOfficer.push("Notify inspection team");
  if (needManager && !esc.investigator_rec) missingOfficer.push("Your recommendation");
  if (
    needManager &&
    esc.investigator_rec === meta.others &&
    !esc.investigator_rec_other.trim()
  )
    missingOfficer.push("Recommendation description");
  const missing = managerMode
    ? [
        !mg.manager_rec && "Manager recommendation",
        mg.manager_rec === meta.others &&
          !mg.manager_rec_other.trim() &&
          "Manager recommendation description",
      ].filter(Boolean)
    : missingOfficer;
  const officerRecText = recText(
    meta,
    esc.investigator_rec,
    esc.investigator_rec_other
  );

  const targetModule = isTM ? f.module : c.module || "";
  // inspection team notification: filled in from the report until the officer edits it
  const [edited, setEdited] = useState(!!esc.notify_template);
  const escDate =
    needManager &&
    c.status === meta.escalate &&
    String(c.escalated_to) === f.escalated_to
      ? fmtDay(c.escalated_at)
      : todayLabel();
  const investigator = c.assigned_name || user.name;
  useEffect(() => {
    if (needManager && !edited)
      setEsc((e) => ({
        ...e,
        notify_template: buildNotifyTemplate({
          date: escDate,
          bu: f.bu,
          company: c.company,
          request_no: c.request_no,
          alert_category: f.alert_category,
          details: e.findings,
          investigator,
        }),
      }));
  }, [needManager, edited, esc.findings, f.bu, f.alert_category, escDate]);
  const saveManager = async () => {
    setBusy(true);
    setErr("");
    try {
      const u = await api(`/cases/${c.id}/manager-recommendation`, {
        method: "PUT",
        body: mg,
      });
      notifyCasesChanged();
      onSaved(u);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const body = {
        ...f,
        module: targetModule || null,
        ...(needManager ? { escalation: esc } : {}),
      };
      const u = await api(`/cases/${c.id}/review`, { method: "PUT", body });
      onSaved(u);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const Req = ({ children, htmlFor }) => (
    <label htmlFor={htmlFor}>
      {children} <span className="req">*</span>
    </label>
  );
  return (
    <Modal
      wide
      title={`${managerMode ? "Manager recommendation" : "Review"} · ${
        c.request_no
      }`}
      onClose={onClose}
      footer={
        <>
          {missing.length > 0 && (
            <span
              className="muted"
              style={{ fontSize: 12, marginRight: "auto" }}
            >
              Required: {missing.join(", ")}
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            id="btn-save-review"
            className="btn btn-primary"
            disabled={busy || missing.length > 0}
            onClick={managerMode ? saveManager : save}
          >
            {busy
              ? "Saving…"
              : managerMode
              ? "Save manager recommendation"
              : "Save review"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
        {c.company}
      </p>
      {err && (
        <div className="error-box" style={{ marginBottom: 14 }}>
          {err}
        </div>
      )}
      {c.status === meta.possible && (
        <div className="hold-box">
          ⏸ This case is on hold as <b>Possible</b>. Set Status to <b>False</b>,
          or to <b>Escalate to Manager</b> to send it to{" "}
          {managers.map((m) => m.name).join(" or ") || "a manager"} for a
          decision.
        </div>
      )}
      {managerMode && (
        <div className="hold-box">
          ↑ Escalated by <b>{c.assigned_name || "the officer"}</b> to{" "}
          <b>{c.escalated_name}</b> on <b>{fmtStamp(c.escalated_at)}</b>. The
          officer's review is shown for reference; choose the{" "}
          <b>Manager recommendation</b> below.
        </div>
      )}
      {!managerMode &&
        c.status === meta.escalate &&
        (c.esc_manager_rec ? (
          <div className="hold-box ok">
            ✓ <b>{c.esc_manager_by_name}</b> recommended{" "}
            <b>{recText(meta, c.esc_manager_rec, c.esc_manager_rec_other)}</b>.
            Tick <b>True Match</b> below and choose the action plan, or set
            Status to <b>False</b>.
          </div>
        ) : (
          <div className="hold-box">
            ↑ Escalated to <b>{c.escalated_name}</b> on{" "}
            <b>{fmtStamp(c.escalated_at)}</b>, waiting for the manager's
            recommendation. True Match or False can be set once it is recorded.
          </div>
        ))}
      {/* the officer's form: locked (disabled) in manager mode */}
      <fieldset className="fieldset-plain" disabled={managerMode}>
      <div className="form-grid">
        <div className="field">
          <Req htmlFor="rv-app">Application Type</Req>
          <select
            id="rv-app"
            className="input"
            value={f.app_type}
            onChange={set("app_type")}
          >
            <option value="">Select…</option>
            {meta.appTypes.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <Req htmlFor="rv-bu">BU</Req>
          <select
            id="rv-bu"
            className="input"
            value={f.bu}
            onChange={set("bu")}
          >
            <option value="">Select…</option>
            {meta.bus.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <Req htmlFor="rv-wc">World-Check Reference</Req>
          <input
            id="rv-wc"
            className="input"
            maxLength={300}
            value={f.wc_reference}
            onChange={set("wc_reference")}
            placeholder="e.g. WC-5521-883"
          />
        </div>
        <div className="field">
          <Req htmlFor="rv-match">Matched Individual/Company</Req>
          <input
            id="rv-match"
            className="input"
            maxLength={300}
            value={f.matched_party}
            onChange={set("matched_party")}
          />
        </div>
        <div className="field">
          <Req htmlFor="rv-cat">Alert Category</Req>
          <select
            id="rv-cat"
            className="input"
            value={f.alert_category}
            onChange={set("alert_category")}
          >
            <option value="">Select…</option>
            {meta.alertCategories.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <Req htmlFor="rv-status">Status</Req>
          <select
            id="rv-status"
            className="input"
            value={f.status}
            onChange={set("status")}
            disabled={isTM}
          >
            {isTM && <option>{TM}</option>}
            {statusOptions.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          {isTM && (
            <span className="muted" style={{ fontSize: 12 }}>
              Set by the True Match checkbox.
            </span>
          )}
        </div>

        {needReason && (
          <div className="field full">
            <Req htmlFor="rv-reason">Reason for False</Req>
            <textarea
              id="rv-reason"
              className="input"
              rows={3}
              maxLength={1000}
              value={f.false_reason}
              onChange={set("false_reason")}
              placeholder="Why is this not a match? e.g. date of birth and nationality differ from the World-Check profile"
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Saved to the case remarks.
            </span>
          </div>
        )}
        {needManager && (
          <div className="field full">
            <Req htmlFor="rv-mgr">Escalated to</Req>
            <select
              id="rv-mgr"
              className="input"
              value={f.escalated_to}
              onChange={set("escalated_to")}
            >
              <option value="">Select a manager…</option>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.title ? ` (${u.title})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {needManager && (
          <div className="field full">
            <div className="esc-report" id="esc-report">
              <div className="esc-report-h">
                Report{" "}
                <span className="muted">
                  · sent to{" "}
                  {managers.find((m) => String(m.id) === f.escalated_to)
                    ?.name || "the manager"}
                </span>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Date escalated to manager</label>
                  <input className="input" disabled value={escDate} />
                </div>
                <div className="field">
                  <label>BU</label>
                  <input className="input" disabled value={f.bu || "—"} />
                </div>
                <div className="field">
                  <label>Company name</label>
                  <input className="input" disabled value={c.company} />
                </div>
                <div className="field">
                  <label>Alert Category</label>
                  <input
                    className="input"
                    disabled
                    value={f.alert_category || "—"}
                  />
                </div>
                <div className="field full">
                  <label>Investigator name</label>
                  <input className="input" disabled value={investigator} />
                </div>
                <div className="field full">
                  <Req htmlFor="esc-findings">Crime/alert details</Req>
                  <textarea
                    id="esc-findings"
                    className="input"
                    rows={4}
                    maxLength={2000}
                    value={esc.findings}
                    onChange={setE("findings")}
                    placeholder="e.g. UBO matches World-Check PEP profile (ref 5521883); 2 adverse media reports 2023–2024"
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Text and numbers. The manager sees this report with your
                    recommendation.
                  </span>
                </div>
                <div className="field full">
                  <div
                    className="row"
                    style={{ justifyContent: "space-between" }}
                  >
                    <Req htmlFor="esc-template">Report</Req>
                    <NotifyActions
                      subject={notifySubject(c)}
                      body={esc.notify_template}
                    />
                  </div>
                  <textarea
                    id="esc-template"
                    className="input mono"
                    rows={9}
                    maxLength={5000}
                    value={esc.notify_template}
                    onChange={(e) => {
                      setEsc({ ...esc, notify_template: e.target.value });
                      setEdited(true);
                    }}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Filled in from the report above; you can edit it. It's saved
                    with the escalation.
                    {edited && !managerMode && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href="#"
                          style={{ color: "var(--primary-2)" }}
                          onClick={(e) => {
                            e.preventDefault();
                            setEdited(false);
                          }}
                        >
                          Reset to template
                        </a>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
        {needManager && (
          <div
            className={`field ${
              esc.investigator_rec === meta.others ? "" : "full"
            }`}
          >
            <Req htmlFor="esc-rec">
              {managerMode ? "Officer recommendation" : "Your recommendation"}
            </Req>
            <select
              id="esc-rec"
              className="input"
              value={esc.investigator_rec}
              onChange={setE("investigator_rec")}
            >
              <option value="">Select…</option>
              {meta.investigatorRecs.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
        )}
        {needManager && esc.investigator_rec === meta.others && (
          <div className="field">
            <Req htmlFor="esc-rec-other">Describe the recommendation</Req>
            <input
              id="esc-rec-other"
              className="input"
              maxLength={300}
              value={esc.investigator_rec_other}
              onChange={setE("investigator_rec_other")}
            />
          </div>
        )}
        {tmAllowed && !managerMode && (
          <div className="field full">
            <label className="tm-check" htmlFor="rv-tm">
              <input
                id="rv-tm"
                type="checkbox"
                checked={isTM}
                onChange={(e) => setTM(e.target.checked)}
              />
              <span>
                <b>True Match</b>
                <span className="muted">
                  {" "}
                  · confirmed after the manager’s recommendation
                  {c.esc_manager_rec
                    ? ` (${recText(
                        meta,
                        c.esc_manager_rec,
                        c.esc_manager_rec_other
                      )})`
                    : ""}
                </span>
              </span>
            </label>
          </div>
        )}
        {isTM && (
          <div className="field full">
            <Req htmlFor="rv-module">Action plan</Req>
            <select
              id="rv-module"
              className="input"
              value={f.module}
              onChange={set("module")}
            >
              <option value="">Select…</option>
              {ACTION_PLANS.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>
              {f.module === meta.hmSlug
                ? "Heightened Monitoring uses the details from the escalation report."
                : isNFA
                ? "The case is closed with no further action."
                : "Heightened Monitoring and No further action cases are also listed under Red Flag; SAR cases only under SAR."}
            </span>
          </div>
        )}
        {isNFA && (
          <div className="field full">
            <Req htmlFor="rv-nfa">
              Reason for closing it as no further action
            </Req>
            <textarea
              id="rv-nfa"
              className="input"
              rows={3}
              maxLength={1000}
              value={f.nfa_reason}
              onChange={set("nfa_reason")}
              placeholder="e.g. Manager confirmed the match; exposure already mitigated, no further steps needed"
            />
            <span className="muted" style={{ fontSize: 12 }}>
              Saved to the case remarks.
            </span>
          </div>
        )}
      </div>
      </fieldset>
      {managerMode && (
        <div className="form-grid mgr-section">
          <div
            className={`field ${
              mg.manager_rec === meta.others ? "" : "full"
            }`}
          >
            <Req htmlFor="rv-mgr-rec">Manager recommendation</Req>
            <select
              id="rv-mgr-rec"
              className="input"
              value={mg.manager_rec}
              onChange={(e) => setMg({ ...mg, manager_rec: e.target.value })}
            >
              <option value="">Select…</option>
              {meta.managerRecs.map((o) => (
                <option key={o} value={o}>
                  {o === meta.agreed && officerRecText
                    ? `${o} (${officerRecText})`
                    : o}
                </option>
              ))}
            </select>
          </div>
          {mg.manager_rec === meta.others && (
            <div className="field">
              <Req htmlFor="rv-mgr-rec-other">Describe the recommendation</Req>
              <input
                id="rv-mgr-rec-other"
                className="input"
                maxLength={300}
                value={mg.manager_rec_other}
                onChange={(e) =>
                  setMg({ ...mg, manager_rec_other: e.target.value })
                }
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ---------- create one ---------- */
function NewCaseModal({ users, onClose, onCreated }) {
  const toast = useToast();
  const [f, setF] = useState({ company: "", request_no: "", assigned_to: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (another) => {
    setBusy(true);
    setErr("");
    try {
      const c = await api("/cases", {
        method: "POST",
        body: { ...f, assigned_to: f.assigned_to || null },
      });
      toast(
        `${c.request_no} created${
          c.assigned_name ? ` and assigned to ${c.assigned_name}` : ""
        }`
      );
      onCreated();
      if (another)
        setF({ company: "", request_no: "", assigned_to: f.assigned_to });
      else onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const ok = f.company.trim() && f.request_no.trim();
  return (
    <Modal
      title="New case"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={!ok || busy}
            onClick={() => save(true)}
          >
            Create &amp; add another
          </button>
          <button
            id="btn-create-case"
            className="btn btn-primary"
            disabled={!ok || busy}
            onClick={() => save(false)}
          >
            Create case
          </button>
        </>
      }
    >
      <div className="grid">
        {err && <div className="error-box">{err}</div>}
        <div className="field">
          <label htmlFor="nc-company">Company name</label>
          <input
            id="nc-company"
            className="input"
            autoFocus
            value={f.company}
            onChange={(e) => setF({ ...f, company: e.target.value })}
            placeholder="e.g. KELIDA CONSTRUCTION - FZCO"
          />
        </div>
        <div className="field">
          <label htmlFor="nc-sr">Service Request</label>
          <input
            id="nc-sr"
            className="input"
            value={f.request_no}
            onChange={(e) => setF({ ...f, request_no: e.target.value })}
            placeholder="e.g. DSO-LIC-225856"
          />
        </div>
        <div className="field">
          <label htmlFor="nc-assign">Assign to</label>
          <select
            id="nc-assign"
            className="input"
            value={f.assigned_to}
            onChange={(e) => setF({ ...f, assigned_to: e.target.value })}
          >
            <option value="">Leave unassigned for now</option>
            {users
              .filter((u) => u.status === "active")
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.title ? ` (${u.title})` : ""}
                </option>
              ))}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            The case goes to this officer's Cases queue. Its category (True
            Match, HM, RF, SAR) is decided after review.
          </span>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- bulk upload ---------- */
function BulkModal({ onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const send = (f, commit) => {
    const form = new FormData();
    form.append("file", f);
    form.append("commit", commit ? "1" : "0");
    return api("/cases/bulk", { method: "POST", form });
  };
  const pick = async (f) => {
    setFile(f);
    setPreview(null);
    setErr("");
    if (!f) return;
    setBusy(true);
    try {
      setPreview(await send(f, false));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const doImport = async () => {
    setBusy(true);
    try {
      const r = await send(file, true);
      toast(
        `${r.created} case(s) created${
          r.skipped ? `, ${r.skipped} skipped` : ""
        }`
      );
      onDone();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const template = () =>
    exportCSV(
      "cases-template.csv",
      [{ c: "KELIDA CONSTRUCTION - FZCO", s: "DSO-LIC-225856", a: "Firas" }],
      [
        { label: "Company name", get: (r) => r.c },
        { label: "Service Request", get: (r) => r.s },
        { label: "Assign", get: (r) => r.a },
      ]
    );

  return (
    <Modal
      wide
      title="Bulk upload cases"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            id="btn-bulk-import"
            className="btn btn-primary"
            disabled={!preview?.valid || busy}
            onClick={doImport}
          >
            {busy && preview
              ? "Importing…"
              : `Import ${preview?.valid ?? ""} case(s)`}
          </button>
        </>
      }
    >
      <div className="grid">
        <p className="muted" style={{ margin: 0 }}>
          Excel or CSV with columns <b>Company name</b>, <b>Service Request</b>{" "}
          and <b>Assign</b> (officer name or email; leave blank to assign
          later).{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              template();
            }}
            style={{ color: "var(--primary-2)" }}
          >
            Download template
          </a>
        </p>
        <input
          id="bulk-file"
          type="file"
          className="input"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => pick(e.target.files[0] || null)}
        />
        {err && <div className="error-box">{err}</div>}
        {busy && !preview && <div className="muted">Checking file…</div>}
        {preview && (
          <>
            <div className="row">
              <span className="badge done">{preview.valid} ready</span>
              {preview.invalid > 0 && (
                <span className="badge leave">
                  {preview.invalid} will be skipped
                </span>
              )}
            </div>
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Company name</th>
                    <th>Service Request</th>
                    <th>Assign</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.row}>
                      <td className="muted">{r.row}</td>
                      <td style={{ whiteSpace: "normal" }}>
                        {r.company || <span className="muted">—</span>}
                      </td>
                      <td>
                        {r.request_no || <span className="muted">—</span>}
                      </td>
                      <td>
                        {r.assignee ? (
                          <>
                            {r.assignee.name}
                            {r.fuzzy && (
                              <div className="muted" style={{ fontSize: 11 }}>
                                from “{r.assign}”: check spelling
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="muted">
                            {r.assign || "Unassigned"}
                          </span>
                        )}
                      </td>
                      <td>
                        {r.error ? (
                          <span className="badge leave">{r.error}</span>
                        ) : (
                          <span
                            className={`badge ${r.fuzzy ? "pending" : "done"}`}
                          >
                            {r.fuzzy ? "OK, name matched" : "OK"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ---------- delete (admin) ---------- */
function DeleteModal({ list, onClose, onDeleted }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const remarks = list.reduce((n, c) => n + (c.remark_count || 0), 0);
  const del = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api("/cases/delete", {
        method: "POST",
        body: { caseIds: list.map((c) => c.id), reason },
      });
      toast(`${r.deleted} case(s) deleted`);
      onDeleted();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        list.length === 1
          ? `Delete ${list[0].request_no}?`
          : `Delete ${list.length} cases?`
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            id="btn-confirm-delete"
            className="btn btn-danger"
            disabled={busy || !reason.trim()}
            onClick={del}
          >
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </>
      }
    >
      <div className="grid">
        {err && <div className="error-box">{err}</div>}
        <div className="error-box">
          This removes the case{list.length > 1 ? "s" : ""} from every list,
          together with {remarks ? `${remarks} remark(s)` : "any remarks"} and
          the activity history. A copy is kept in the deletion log for audit.
          This cannot be undone from the app.
        </div>
        <div className="table-wrap" style={{ maxHeight: 180 }}>
          <table>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.request_no}</b>
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{c.company}</td>
                  <td className="muted">{c.assigned_name || "Unassigned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="field">
          <label htmlFor="del-reason">
            Reason for deleting <span className="req">*</span>
          </label>
          <textarea
            id="del-reason"
            className="input"
            rows={2}
            maxLength={1000}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Created by mistake / duplicate of DSO-LIC-225856"
          />
        </div>
      </div>
    </Modal>
  );
}

/* ---------- detail ---------- */
/* Escalation to manager, inside the case: the officer's report + recommendation, and (admin) the mandatory manager recommendation. */
function EscalationPanel({ c, onUpdated }) {
  const meta = useMeta();
  const { user } = useAuth();
  const toast = useToast();
  const open = c.status === meta.escalate && !c.esc_decided_at;
  const canRecommend = user.role === "admin" && open;
  const [editing, setEditing] = useState(canRecommend && !c.esc_manager_rec);
  const [m, setM] = useState({
    manager_rec: c.esc_manager_rec || "",
    manager_rec_other: c.esc_manager_rec_other || "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const officerRec = recText(
    meta,
    c.esc_investigator_rec,
    c.esc_investigator_rec_other
  );
  const missing = [
    !m.manager_rec && "Manager recommendation",
    m.manager_rec === meta.others &&
      !m.manager_rec_other.trim() &&
      "Recommendation description",
  ].filter(Boolean);
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const u = await api(`/cases/${c.id}/manager-recommendation`, {
        method: "PUT",
        body: m,
      });
      toast(`Manager recommendation recorded for ${c.request_no}`);
      setEditing(false);
      onUpdated?.(u);
      notifyCasesChanged();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  const F = ({ l, children, full }) => (
    <div className={full ? "full" : ""}>
      <div className="muted">{l}</div>
      <b style={{ whiteSpace: "pre-wrap" }}>{children || "—"}</b>
    </div>
  );

  return (
    <>
      <h3 style={{ fontSize: 15, margin: "20px 0 10px" }}>
        Escalation to manager
      </h3>
      <div className="esc-box">
        <div className="form-grid">
          <F l="Date">{fmtDay(c.escalated_at)}</F>
          <F l="Escalated to">{c.escalated_name}</F>
          <F l="BU">{c.esc_bu || c.bu}</F>
          <F l="Company name">{c.company}</F>
          <F l="Alert Category">{c.esc_alert_category}</F>
          <F l="Investigator name">{c.esc_investigator}</F>
          <F l="Crime/alert details" full>
            {c.esc_findings}
          </F>
          {c.esc_template && (
            <div className="full">
              <div
                className="row"
                style={{ justifyContent: "space-between", marginBottom: 6 }}
              >
                <span className="muted">Notify inspection team</span>
                <NotifyActions
                  subject={notifySubject(c)}
                  body={c.esc_template}
                />
              </div>
              <pre className="hm-template">{c.esc_template}</pre>
            </div>
          )}
          {editing ? (
            <>
              <div className="field full">
                <label htmlFor="mg-officer-rec">Investigator recommendation</label>
                <select id="mg-officer-rec" className="input" disabled value={officerRec || ""}>
                  <option value={officerRec || ""}>{officerRec || "—"}</option>
                </select>
              </div>
              <div
                className={`field ${
                  m.manager_rec === meta.others ? "" : "full"
                }`}
              >
                <label htmlFor="mg-rec">
                  Manager recommendation <span className="req">*</span>
                </label>
                <select
                  id="mg-rec"
                  className="input"
                  value={m.manager_rec}
                  onChange={(x) => setM({ ...m, manager_rec: x.target.value })}
                >
                  <option value="">Select…</option>
                  {meta.managerRecs.map((o) => (
                    <option key={o} value={o}>
                      {o === meta.agreed ? `${o} (${officerRec})` : o}
                    </option>
                  ))}
                </select>
              </div>
              {m.manager_rec === meta.others && (
                <div className="field">
                  <label htmlFor="mg-rec-other">
                    Describe the recommendation <span className="req">*</span>
                  </label>
                  <input
                    id="mg-rec-other"
                    className="input"
                    maxLength={300}
                    value={m.manager_rec_other}
                    onChange={(x) =>
                      setM({ ...m, manager_rec_other: x.target.value })
                    }
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <F l="Investigator recommendation" full>
                {officerRec}
              </F>
              <F l="Manager recommendation">
                {c.esc_manager_rec ? (
                  <>
                    {recText(meta, c.esc_manager_rec, c.esc_manager_rec_other)}
                    <div className="cell-note">
                      {c.esc_manager_by_name} · {fmtDay(c.esc_manager_at)}
                    </div>
                  </>
                ) : (
                  <span className="badge pending">Awaiting manager</span>
                )}
              </F>
              <F l="Outcome">
                {c.esc_decision
                  ? `${c.esc_decision} · ${
                      c.esc_decided_by_name || "—"
                    } · ${fmtDay(c.esc_decided_at)}`
                  : c.esc_manager_rec
                  ? "Back with the officer for True Match / False"
                  : "—"}
              </F>
            </>
          )}
        </div>
        {err && (
          <div className="error-box" style={{ marginTop: 12 }}>
            {err}
          </div>
        )}
        {canRecommend && (
          <div
            className="row"
            style={{ justifyContent: "flex-end", marginTop: 12 }}
          >
            {editing ? (
              <>
                {missing.length > 0 && (
                  <span
                    className="muted"
                    style={{ fontSize: 12, marginRight: "auto" }}
                  >
                    Required: {missing.join(", ")}
                  </span>
                )}
                {c.esc_manager_rec && (
                  <button
                    className="btn btn-sm"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                )}
                <button
                  id="btn-mgr-save"
                  className="btn btn-primary btn-sm"
                  disabled={busy || missing.length > 0}
                  onClick={save}
                >
                  {busy ? "Saving…" : "Save recommendation"}
                </button>
              </>
            ) : (
              <button
                id="btn-mgr-edit"
                className="btn btn-sm"
                onClick={() => setEditing(true)}
              >
                Edit recommendation
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function CaseDetail({
  c,
  canReview,
  readOnly,
  onReview,
  onDelete,
  onClose,
  onRemarks,
  onUpdated,
}) {
  const meta = useMeta();
  const [history, setHistory] = useState([]);
  useEffect(() => {
    api(`/cases/${c.id}/history`)
      .then(setHistory)
      .catch(() => {});
  }, [c.id, c.updated_at]);
  const F = ({ l, children }) => (
    <div>
      <div className="muted">{l}</div>
      <b>{children || "—"}</b>
    </div>
  );
  return (
    <Modal
      size="xl"
      title={`${c.request_no} · ${c.company}`}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button
              id="btn-delete-case"
              className="btn btn-danger"
              style={{ marginRight: "auto" }}
              onClick={onDelete}
            >
              🗑 Delete case
            </button>
          )}
          {canReview && (
            <button className="btn btn-primary" onClick={onReview}>
              Review case
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="detail-split">
        <div className="detail-main">
          <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
            <span className="tag">
              {moduleName(c.module) || "No action plan"}
            </span>
            <Badge v={c.status} />
            <StatusNotes c={c} meta={meta} />
          </div>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <F l="Assigned to">{c.assigned_name || "Unassigned"}</F>
            <F l="Created by">
              {c.created_by_name
                ? `${c.created_by_name} · ${fmtStamp(c.created_at)}`
                : fmtStamp(c.created_at)}
            </F>
            <F l="Application Type">{c.app_type}</F>
            <F l="BU">{c.bu}</F>
            <F l="World-Check Reference">{c.wc_reference}</F>
            <F l="Matched Individual/Company">{c.matched_party}</F>
            <F l="Alert Category">{c.alert_category}</F>
            <F l="Status">{c.status}</F>
            {c.status === "False" && (
              <div className="full">
                <div className="muted">Reason for False</div>
                <b style={{ whiteSpace: "pre-wrap" }}>{c.false_reason}</b>
              </div>
            )}
            {c.module && <F l="Action plan">{moduleName(c.module)}</F>}
            {c.module === NFA.slug && (
              <div className="full">
                <div className="muted">Reason for no further action</div>
                <b style={{ whiteSpace: "pre-wrap" }}>{c.nfa_reason}</b>
              </div>
            )}
          </div>
          {c.esc_id && <EscalationPanel c={c} onUpdated={onUpdated} />}
          {c.hm_date && (
            <>
              <h3 style={{ fontSize: 15, margin: "20px 0 10px" }}>
                Heightened Monitoring
              </h3>
              <div className="form-grid hm-box">
                <F l="Date">{fmtDay(c.hm_date)}</F>
                <F l="BU">{c.hm_bu}</F>
                <F l="Alert Category">{c.hm_alert_category}</F>
                <F l="Investigator">{c.hm_investigator}</F>
                <div className="full">
                  <div className="muted">Crime/alert details</div>
                  <b style={{ whiteSpace: "pre-wrap" }}>{c.hm_details}</b>
                </div>
                {c.hm_template && !c.esc_template && (
                  <div className="full">
                    <div
                      className="row"
                      style={{
                        justifyContent: "space-between",
                        marginBottom: 6,
                      }}
                    >
                      <span className="muted">
                        Inspection team notification
                      </span>
                      <NotifyActions
                        subject={notifySubject(c)}
                        body={c.hm_template}
                      />
                    </div>
                    <pre className="hm-template">{c.hm_template}</pre>
                  </div>
                )}
              </div>
            </>
          )}
          <h3 className="detail-h">Activity</h3>
          {history.map((h) => (
            <div key={h.id} className="activity-row">
              <b>{h.type}</b>
              {h.type === "assigned" && (
                <>
                  {" "}
                  · {h.from_name || "Unassigned"} → {h.to_name}
                </>
              )}
              {h.type === "created" && h.to_name && (
                <> · assigned to {h.to_name}</>
              )}
              {h.type === "escalated" && <> · to {h.to_name}</>}
              {h.detail && <> · {h.detail}</>} · by {h.by_name || "system"} ·{" "}
              {fmtStamp(h.at)}
            </div>
          ))}
        </div>
        <aside className="detail-side">
          <h3 className="detail-h" style={{ marginTop: 0 }}>
            Remarks &amp; findings
          </h3>
          <Remarks
            base={`/cases/${c.id}`}
            readOnly={readOnly}
            onCount={(n) => onRemarks?.(c.id, n)}
          />
        </aside>
      </div>
    </Modal>
  );
}

/* ---------- page: /cases (all) and /cases/:view (a module) ---------- */
export default function Cases() {
  const { view = "all" } = useParams();
  const module = CASE_MODULES.find((m) => m.slug === view);
  const { user } = useAuth();
  const meta = useMeta();
  const toast = useToast();
  const isAdmin = user.role === "admin";
  // officers: Master Data (/cases) lists every case, view only · My Cases (/cases/mine) lists theirs, to review
  const isMine = view === "mine" && !isAdmin;
  const readOnly = !isAdmin && view === "all";
  const listView = isMine ? "all" : view; // My Cases behaves like Master Data, limited to the officer
  const defaultScope = isAdmin || readOnly ? "all" : "mine";
  const isHm = view === meta.hmSlug;

  // All Cases: open (waiting for a decision) | completed (True Match / False) | all · categories: active | false | all
  // My Cases: working (Active) | pending (escalated to a manager) | completed
  // Red Flag: a single "All" tab for now (every red-flag case)
  const firstTab = view === RED_FLAG ? "all" : isMine ? "working" : listView === "all" ? "open" : "active";
  const [tab, setTab] = useState(firstTab);
  const [scope, setScope] = useState(defaultScope);
  const [category, setCategory] = useState(""); // only on All Cases
  const [search, setSearch] = useState("");
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [counts, setCounts] = useState(null);
  const [selected, setSelected] = useState([]);
  const [modal, setModal] = useState(null); // 'new' | 'bulk' | {assign} | {detail} | {review}

  const apiView = listView === "all" ? category || "all" : view;
  const scopeQ = ["all", "unassigned", "mine", "escalated"].includes(scope)
    ? { scope }
    : { scope: "all", assignee: scope };
  const load = () => {
    setLoading(true);
    api("/cases" + qs({ view: apiView, ...scopeQ, tab, search }))
      .then((c) => {
        setCases(c);
        setSelected([]);
        // the user has now seen these cases: clears the sidebar badge for this menu
        // (not the officers' view-only Master Data: it has no badge and shows other people's cases)
        if (c.length && !readOnly)
          api("/cases/seen", { method: "POST", body: { caseIds: c.map((x) => x.id) } })
            .then(() => notifyCasesChanged())
            .catch(() => {});
      })
      .catch((e) => toast(e.message, "error"))
      .finally(() => setLoading(false));
  };
  const loadCounts = () =>
    api("/cases/counts")
      .then(setCounts)
      .catch(() => {});
  const refresh = () => {
    load();
    loadCounts();
    notifyCasesChanged();
  };

  useEffect(() => {
    setTab(firstTab);
    setScope(defaultScope);
    setCategory("");
    setSearch("");
    setModal(null);
  }, [view]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [apiView, tab, scope, search]);
  useEffect(() => {
    loadCounts();
  }, [view]);
  useEffect(() => {
    api("/users")
      .then(setUsers)
      .catch(() => {});
  }, []);

  const activeUsers = useMemo(
    () => users.filter((u) => u.status === "active"),
    [users]
  );
  // escalation managers (set per user in Team & Users; initially Yaser and Raneem)
  const managers = useMemo(
    () => users.filter((u) => u.escalation_manager && u.status === "active"),
    [users]
  );
  if (view !== "all" && !module && !isMine)
    return <Navigate to="/cases" replace />;

  // escalated and the manager recommendation is recorded: back with the officer
  const backFromManager = (u) =>
    u.status === meta.escalate && !!u.esc_manager_rec && !u.esc_decided_at;
  // Completed: decided (True Match / False); for admins also once the manager has recommended
  const isDoneFor = (u) =>
    meta.decisionStatuses.includes(u.status) || (isAdmin && backFromManager(u));
  const onSaved = (u) => {
    const stillHere =
      (listView === "all"
        ? !category ||
          (category === "uncategorised" ? !u.module : u.module === category)
        : view === RED_FLAG
        ? isRedFlag(u, meta)
        : u.module === view) &&
      (tab === "all" ||
        (tab === "working"
          ? !meta.decisionStatuses.includes(u.status) &&
            (u.status !== meta.escalate || backFromManager(u))
          : tab === "pending"
          ? u.status === meta.escalate && !backFromManager(u)
          : tab === "open" || tab === "completed"
          ? (tab === "completed") === isDoneFor(u)
          : (tab === "false") === (u.status === "False")));
    setCases((cs) =>
      stillHere
        ? cs.map((x) => (x.id === u.id ? u : x))
        : cs.filter((x) => x.id !== u.id)
    );
    toast(
      stillHere
        ? `${u.request_no} saved`
        : `${u.request_no} saved and moved to ${
            isMine
              ? u.status === meta.escalate && !backFromManager(u)
                ? "Pending"
                : meta.decisionStatuses.includes(u.status)
                ? "Completed"
                : "Active"
              : tab === "open"
              ? "Completed"
              : tab === "completed"
              ? "Active"
              : u.status === "False"
              ? "False"
              : moduleName(u.module) || "Cases"
          }`
    );
    loadCounts();
    notifyCasesChanged();
  };
  const assign = async (ids, toUserId, reason = "") => {
    try {
      const r = await api("/cases/assign", {
        method: "POST",
        body: { caseIds: ids, toUserId, reason },
      });
      toast(
        `${r.assigned} case(s) assigned to ${
          users.find((u) => u.id === +toUserId)?.name
        }`
      );
      setModal(null);
      refresh();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const canReview = (c) => isAdmin || (!readOnly && c.assigned_to === user.id);
  const allChecked = cases.length > 0 && selected.length === cases.length;
  const k = listView === "all" ? "all" : view;
  const teamWide = (isAdmin && scope !== "mine") || readOnly;
  const activeCount = !counts
    ? "…"
    : listView === "all"
    ? teamWide
      ? counts[k].open
      : counts[k].mine_open
    : teamWide
    ? counts[k].active
    : counts[k].mine;
  const exportRows = () =>
    exportCSV(
      `cases-${view}-${tab}-${new Date().toISOString().slice(0, 10)}.csv`,
      cases,
      [
        { label: "Company name", get: (c) => c.company },
        { label: "Service Request", get: (c) => c.request_no },
        { label: "Assigned to", get: (c) => c.assigned_name || "Unassigned" },
        { label: "Action plan", get: (c) => moduleName(c.module) || "" },
        { label: "Reason for no further action", get: (c) => c.nfa_reason },
        { label: "Application Type", get: (c) => c.app_type },
        { label: "BU", get: (c) => c.bu },
        { label: "World-Check Reference", get: (c) => c.wc_reference },
        { label: "Matched Individual/Company", get: (c) => c.matched_party },
        { label: "Alert Category", get: (c) => c.alert_category },
        { label: "Status", get: (c) => c.status },
        { label: "Reason for False", get: (c) => c.false_reason },
        { label: "Escalated to", get: (c) => c.escalated_name },
        {
          label: "Escalation date",
          get: (c) => c.escalated_at && fmtStamp(c.escalated_at),
        },
        { label: "Created", get: (c) => fmtStamp(c.created_at) },
        { label: "HM date", get: (c) => c.hm_date && fmtDay(c.hm_date) },
        { label: "Crime/alert details", get: (c) => c.hm_details },
        { label: "Investigator", get: (c) => c.hm_investigator },
      ]
    );
  const detail =
    modal?.detail &&
    (cases.find((c) => c.id === modal.detail.id) || modal.detail);
  const reviewing =
    modal?.review &&
    (cases.find((c) => c.id === modal.review.id) || modal.review);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">
            Cases{module?.short ? ` · ${module.short}` : ""}
          </div>
          <h1>{module ? module.name : isMine ? "My Cases" : "Master Data"}</h1>
          <p>
            {module
              ? module.slug === RED_FLAG
                ? "Every True Match whose action plan is not SAR. Heightened Monitoring cases also appear here."
                : `True Match cases with ${module.name} as the action plan.`
              : isMine
              ? "Cases assigned to you. Open a case and complete the review: every field is required."
              : readOnly
              ? "Every case across the team. View only: your own cases are under My Cases."
              : isAdmin
              ? "Create cases and assign them to the team. A confirmed True Match gets an action plan: HM, SAR or no further action, and is listed under Red Flag unless it is SAR."
              : "Cases assigned to you. Open a case and complete the review: every field is required."}
          </p>
        </div>
        <div className="row">
          {readOnly && <span className="badge">🔒 View only</span>}
          {isAdmin && (
            <select
              id="cs-scope"
              className="input"
              style={{ width: "auto" }}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">All officers</option>
              <option value="unassigned">
                Unassigned
                {counts?.[k].unassigned ? ` (${counts[k].unassigned})` : ""}
              </option>
              <option value="escalated">
                Escalated to me
                {counts?.[k].escalated_to_me
                  ? ` (${counts[k].escalated_to_me})`
                  : ""}
              </option>
              <option value="mine">Assigned to me</option>
              <optgroup label="Officer">
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
          {isAdmin && view === "all" && (
            <button
              id="btn-bulk"
              className="btn"
              onClick={() => setModal("bulk")}
            >
              ⤒ Bulk upload
            </button>
          )}
          {isAdmin && view === "all" && (
            <button
              id="btn-new-case"
              className="btn btn-primary"
              onClick={() => setModal("new")}
            >
              ＋ New case
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {isMine ? (
          <>
            <button
              id="cs-tab-active"
              className={`tab ${tab === "working" ? "on" : ""}`}
              onClick={() => setTab("working")}
              title="Cases for you to work on"
            >
              Active{" "}
              <span className="count">
                {counts ? counts.all.mine_working : "…"}
              </span>
            </button>
            <button
              id="cs-tab-pending"
              className={`tab ${tab === "pending" ? "on" : ""}`}
              onClick={() => setTab("pending")}
              title="Escalated to a manager"
            >
              Pending{" "}
              <span className="count">
                {counts ? counts.all.mine_pending : "…"}
              </span>
            </button>
            <button
              id="cs-tab-completed"
              className={`tab ${tab === "completed" ? "on" : ""}`}
              onClick={() => setTab("completed")}
              title="Decided: True Match or False"
            >
              Completed
            </button>
          </>
        ) : listView === "all" ? (
          <>
            <button
              id="cs-tab-active"
              className={`tab ${tab === "open" ? "on" : ""}`}
              onClick={() => setTab("open")}
              title="Waiting for a decision: Under Review, Possible, Escalated to Manager, Requested Further Documents"
            >
              Active <span className="count">{activeCount}</span>
            </button>
            <button
              id="cs-tab-completed"
              className={`tab ${tab === "completed" ? "on" : ""}`}
              onClick={() => setTab("completed")}
              title="Decided: True Match or False"
            >
              Completed
            </button>
          </>
        ) : view === RED_FLAG ? null : (
          <>
            <button
              id="cs-tab-active"
              className={`tab ${tab === "active" ? "on" : ""}`}
              onClick={() => setTab("active")}
            >
              Active <span className="count">{activeCount}</span>
            </button>
            <button
              id="cs-tab-false"
              className={`tab ${tab === "false" ? "on" : ""}`}
              onClick={() => setTab("false")}
            >
              False
            </button>
          </>
        )}
        {!isMine && (
          <button
            id="cs-tab-all"
            className={`tab ${tab === "all" ? "on" : ""}`}
            onClick={() => setTab("all")}
          >
            All
            {view === RED_FLAG && (
              <>
                {" "}
                <span className="count">{tab === "all" && !loading ? cases.length : "…"}</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <input
            id="cs-search"
            className="input grow"
            placeholder="Search company, service request, World-Check ref, matched party…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {listView === "all" && (
            <select
              id="cs-category"
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All action plans</option>
              <option value="uncategorised">No action plan yet</option>
              {ACTION_PLANS.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn" onClick={exportRows} disabled={!cases.length}>
            ⤓ Export
          </button>
        </div>

        {isAdmin && selected.length > 0 && (
          <div
            className="row card"
            style={{
              padding: "10px 14px",
              marginBottom: 12,
              background: "hsla(252 90% 67% / .1)",
            }}
          >
            <b>{selected.length} selected</b>
            <button
              id="btn-cs-assign"
              className="btn btn-primary btn-sm"
              style={{ marginLeft: "auto" }}
              onClick={() =>
                setModal({ assign: { ids: selected, to: "", reason: "" } })
              }
            >
              ⇄ Assign / reassign
            </button>
            <button
              id="btn-cs-delete"
              className="btn btn-danger btn-sm"
              onClick={() =>
                setModal({ del: cases.filter((c) => selected.includes(c.id)) })
              }
            >
              🗑 Delete
            </button>
            <button className="btn btn-sm" onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
        )}

        {/* key: start each sub-menu scrolled to the first column */}
        <div className="table-wrap" key={view}>
          <table>
            <thead>
              <tr>
                {isAdmin && (
                  <th className="col-check">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() =>
                        setSelected(allChecked ? [] : cases.map((c) => c.id))
                      }
                    />
                  </th>
                )}
                <th>Company name</th>
                <th>Service Request</th>
                <th>Assigned to</th>
                {listView === "all" && <th>Action plan</th>}
                {isHm && (
                  <>
                    <th>HM date</th>
                    <th>Crime/alert details</th>
                    <th>Investigator</th>
                  </>
                )}
                <th className="th-manual">Application Type</th>
                <th className="th-manual">BU</th>
                <th className="th-manual">World-Check Reference</th>
                <th className="th-manual">Matched Individual/Company</th>
                <th className="th-manual">Alert Category</th>
                <th className="th-manual">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr
                  key={c.id}
                  className={selected.includes(c.id) ? "selected" : ""}
                >
                  {isAdmin && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={() =>
                          setSelected((s) =>
                            s.includes(c.id)
                              ? s.filter((x) => x !== c.id)
                              : [...s, c.id]
                          )
                        }
                      />
                    </td>
                  )}
                  <td className="col-company">{c.company}</td>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setModal({ detail: c });
                      }}
                      className="cell-link"
                    >
                      {c.request_no}
                    </a>
                    <div style={{ marginTop: 4 }}>
                      <RemarkCount n={c.remark_count} />
                    </div>
                  </td>
                  <td>
                    {isAdmin ? (
                      <select
                        className="input cell-select"
                        id={`cs-assign-${c.id}`}
                        value={c.assigned_to || ""}
                        onChange={(e) =>
                          e.target.value && assign([c.id], e.target.value)
                        }
                      >
                        {!c.assigned_to && <option value="">Assign…</option>}
                        {c.assigned_to &&
                          !activeUsers.some((u) => u.id === c.assigned_to) && (
                            <option value={c.assigned_to}>
                              {c.assigned_name} (on leave)
                            </option>
                          )}
                        {activeUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      c.assigned_name || (
                        <span className="badge leave">Unassigned</span>
                      )
                    )}
                  </td>
                  {listView === "all" && (
                    <td>
                      {c.module ? (
                        <span className="tag">{moduleName(c.module)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  )}
                  {isHm && (
                    <>
                      <td>
                        {c.hm_date ? (
                          fmtDay(c.hm_date)
                        ) : (
                          <span className="badge pending">Details missing</span>
                        )}
                      </td>
                      <td className="col-wrap">
                        {c.hm_details || <span className="muted">—</span>}
                      </td>
                      <td>
                        {c.hm_investigator || <span className="muted">—</span>}
                      </td>
                    </>
                  )}
                  <td>{c.app_type || <span className="muted">—</span>}</td>
                  <td>
                    {c.bu ? (
                      <span className="tag">{c.bu}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{c.wc_reference || <span className="muted">—</span>}</td>
                  <td className="col-wrap">
                    {c.matched_party || <span className="muted">—</span>}
                  </td>
                  <td>
                    {c.alert_category || <span className="muted">—</span>}
                  </td>
                  <td>
                    <Badge v={c.status} />
                    <StatusNotes c={c} meta={meta} />
                  </td>
                  <td>
                    {canReview(c) && (
                      <button
                        id={`btn-review-${c.id}`}
                        className="btn btn-sm"
                        onClick={() => setModal({ review: c })}
                      >
                        {c.app_type ? "Update" : "Review"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!cases.length && (
                <tr>
                  <td colSpan={20} className="empty">
                    {loading
                      ? "Loading…"
                      : tab === "completed"
                      ? "No completed cases yet. Cases move here once they are decided as True Match or False."
                      : !["active", "open"].includes(tab)
                      ? "Nothing here yet"
                      : module
                      ? module.slug === RED_FLAG
                        ? "No red flags yet. True Match cases appear here unless their action plan is SAR."
                        : `No ${module.name} cases yet. Cases appear here once a True Match gets ${module.name} as its action plan.`
                      : readOnly
                      ? "No cases waiting for a decision."
                      : isAdmin
                      ? "No cases waiting for a decision. Use “New case” or “Bulk upload” to create some."
                      : "🎉 Nothing assigned to you right now"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {cases.length} record(s)
          {readOnly
            ? " · view only"
            : " · highlighted columns are completed by the assigned officer: all are mandatory"}
        </div>
      </div>

      {modal === "new" && (
        <NewCaseModal
          users={users}
          onClose={() => setModal(null)}
          onCreated={refresh}
        />
      )}
      {modal === "bulk" && (
        <BulkModal onClose={() => setModal(null)} onDone={refresh} />
      )}
      {modal?.assign && (
        <Modal
          title={`Assign ${modal.assign.ids.length} case(s)`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                id="btn-confirm-cs-assign"
                className="btn btn-primary"
                disabled={!modal.assign.to}
                onClick={() =>
                  assign(modal.assign.ids, modal.assign.to, modal.assign.reason)
                }
              >
                Assign
              </button>
            </>
          }
        >
          <div className="grid">
            <div className="field">
              <label>Assign to</label>
              <select
                id="cs-assign-to"
                className="input"
                value={modal.assign.to}
                onChange={(e) =>
                  setModal({ assign: { ...modal.assign, to: e.target.value } })
                }
              >
                <option value="">Select an available officer…</option>
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.title ? ` (${u.title})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Reason (optional)</label>
              <textarea
                className="input"
                rows={2}
                value={modal.assign.reason}
                onChange={(e) =>
                  setModal({
                    assign: { ...modal.assign, reason: e.target.value },
                  })
                }
                placeholder="e.g. Officer on annual leave"
              />
            </div>
          </div>
        </Modal>
      )}
      {detail && (
        <CaseDetail
          c={detail}
          canReview={canReview(detail)}
          readOnly={readOnly && detail.assigned_to !== user.id}
          onReview={() => setModal({ review: detail })}
          onClose={() => setModal(null)}
          onDelete={isAdmin ? () => setModal({ del: [detail] }) : null}
          onUpdated={(u) =>
            setCases((cs) => cs.map((x) => (x.id === u.id ? u : x)))
          }
          onRemarks={(id, n) =>
            setCases((cs) =>
              cs.map((x) => (x.id === id ? { ...x, remark_count: n } : x))
            )
          }
        />
      )}
      {modal?.del && (
        <DeleteModal
          list={modal.del}
          onClose={() => setModal(null)}
          onDeleted={refresh}
        />
      )}
      {reviewing && (
        <ReviewModal
          c={reviewing}
          managers={managers}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
