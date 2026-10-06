import { Link } from "react-router";
import { usePageTitle } from "../hooks/usePageTitle";
import { AdminReports } from "./AdminReports";

// Everyone's reports, to read, answer, and close. Reached from the Reports section of the admin
// dashboard, with a button back to it.
export function AdminReportsPage() {
  usePageTitle("Manage reports");
  return (
    <>
      <div className="page-head">
        <h1>Manage reports</h1>
        <Link to="/admin" className="button secondary">
          Admin dashboard
        </Link>
      </div>
      <AdminReports />
    </>
  );
}
