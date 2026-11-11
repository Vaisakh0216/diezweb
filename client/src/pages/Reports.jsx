import React from "react";
import { Navigate, useParams } from "react-router-dom";
import { REPORTS } from "../components/Layout.jsx";
import ComingSoon from "./ComingSoon.jsx";

const ABOUT = {
  wwg: "The WWG report will be generated here. Its layout and fields will be added once the format is confirmed.",
  "daily-edd": "The daily EDD report (the day's applications received, resubmitted, requested and approved, by BU and officer) will be generated here once the format is confirmed.",
};

/** /reports/:report. Each report is a sub-menu of Reports. */
export default function Reports() {
  const { report } = useParams();
  const r = REPORTS.find((x) => x.slug === report);
  if (!r) return <Navigate to={`/reports/${REPORTS[0].slug}`} replace />;
  return <ComingSoon crumb="Reports" title={`${r.name} Report`}>{ABOUT[r.slug]}</ComingSoon>;
}
