import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { PublicOnly, RequireAuth } from "./components/guards";
import { DashboardPage } from "./pages/DashboardPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PackDetailPage } from "./pages/PackDetailPage";
import { PacksPage } from "./pages/PacksPage";
import { StudyPage } from "./pages/StudyPage";

export function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="packs" element={<PacksPage />} />
          <Route path="packs/:id" element={<PackDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
