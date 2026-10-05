import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import PublicHome from "./pages/PublicHome";
import PublicListing from "./pages/PublicListing";
import PublicStorefront from "./pages/PublicStorefront";
import AdminProviders from "./pages/AdminProviders";
import LegalPage from "./pages/LegalPage";
import { CookieConsent } from "./components/CookieConsent";
import { SiteFooter } from "./components/LegalShell";

function Router() {
  return (
    <Switch>
      <Route path="/" component={PublicHome} />
      <Route path="/dashboard" component={Home} />
      <Route path="/admin/providers" component={AdminProviders} />
      <Route path="/terms"><LegalPage slug="terms" /></Route>
      <Route path="/seller-agreement"><LegalPage slug="seller-agreement" /></Route>
      <Route path="/privacy"><LegalPage slug="privacy" /></Route>
      <Route path="/refunds"><LegalPage slug="refunds" /></Route>
      <Route path="/prohibited-items"><LegalPage slug="prohibited-items" /></Route>
      <Route path="/community-guidelines"><LegalPage slug="community-guidelines" /></Route>
      <Route path="/promotions-terms"><LegalPage slug="promotions-terms" /></Route>
      <Route path="/cookies"><LegalPage slug="cookies" /></Route>
      <Route path="/contact"><LegalPage slug="contact" /></Route>
      <Route path="/about"><LegalPage slug="about" /></Route>
      <Route path="/listing/:id">{(params) => <PublicListing id={Number(params.id)} />}</Route>
      <Route path="/404" component={NotFound} />
      <Route path="/:slug">{(params) => <PublicStorefront slug={params.slug} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-right" />
          <Router />
          <SiteFooter />
          <CookieConsent />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
