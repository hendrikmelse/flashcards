import { Navigate, Route, Routes, useParams } from "react-router";
import { Layout } from "./components/Layout";
import { ActiveLanguagesProvider } from "./components/ActiveLanguagesProvider";
import { PublicOnly, RequireAdmin, RequireAuth } from "./components/guards";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminReportsPage } from "./pages/AdminReportsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DeckPage } from "./pages/DeckPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from "./pages/EmailLinkPages";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PackDetailPage } from "./pages/PackDetailPage";
import { PacksPage } from "./pages/PacksPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StudyPage } from "./pages/StudyPage";

// The pack browser used to live at /packs. Old links and bookmarks still work: they go to
// /add-words.
function LegacyPacksRedirect() {
  const { id } = useParams();
  return <Navigate to={`/add-words${id ? `/${id}` : ""}`} replace />;
}

export function App() {
  return (
    <ActiveLanguagesProvider>
      <AppRoutes />
    </ActiveLanguagesProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      {/* The links in emails work signed in or out: they are opened from a mailbox, often on
          another device. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="deck" element={<DeckPage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="add-words" element={<PacksPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="add-words/:id" element={<PackDetailPage />} />
          <Route path="packs" element={<LegacyPacksRedirect />} />
          <Route path="packs/:id" element={<LegacyPacksRedirect />} />
        </Route>
      </Route>
      {/* The admin area. To anyone who is not an admin it is simply not there: the guard shows the
          same page as an address that does not exist. */}
      <Route element={<RequireAuth />}>
        <Route element={<RequireAdmin />}>
          <Route element={<Layout />}>
            <Route path="admin" element={<AdminDashboardPage />} />
            <Route path="admin/reports" element={<AdminReportsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
