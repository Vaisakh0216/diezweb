import React from "react";
import { Navigate, useParams } from "react-router-dom";
import { REPORTS } from "../components/Layout.jsx";
import ComingSoon from "./ComingSoon.jsx";

const ABOUT = {
  wwg: "",
};

/** /reports/:report. Each report is a sub-menu of Reports. */
export default function Reports() {
  const { report } = useParams();
  const r = REPORTS.find((x) => x.slug === report);
  if (!r) return <Navigate to={`/reports/${REPORTS[0].slug}`} replace />;
  return (
    <ComingSoon crumb="Reports" title={`${r.name} Report`}>
      {ABOUT[r.slug]}
    </ComingSoon>
  );
}
