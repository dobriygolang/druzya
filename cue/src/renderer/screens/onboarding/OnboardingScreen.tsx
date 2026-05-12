// Entry point for the #/onboarding route. Now a thin shim over
// OnboardingFlow (4-step wizard). See OnboardingFlow.tsx for the
// orchestrator + each Welcome/Permissions/Demo/Complete file.
//
// Why a shim and not direct: app.tsx routes on hash and imports this
// file by name. Renaming would mean editing the router and the
// import order; keeping OnboardingScreen as a named export future-
// proofs against the wizard structure changing again.

export { OnboardingFlow as OnboardingScreen } from './OnboardingFlow';
