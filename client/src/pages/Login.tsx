import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Shield, Loader2 } from "lucide-react";

export default function Login() {
  const { needsSetup, login, loginError, loginPending, setup, setupError, setupPending } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login({ username, password });
    } catch {
      // error is surfaced via loginError
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) return;
    if (password.length < 8) return;
    try {
      await setup({ password });
    } catch {
      // error is surfaced via setupError
    }
  };

  const pending = loginPending || setupPending;
  const error = loginError || setupError;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-secondary">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Mighty Mapper</CardTitle>
          <CardDescription>
            {needsSetup
              ? "Create your admin account to get started"
              : "Sign in to your workspace"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={needsSetup ? handleSetup : handleLogin} className="space-y-4">
            {!needsSetup && (
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={needsSetup ? "Minimum 8 characters" : ""}
                autoComplete={needsSetup ? "new-password" : "current-password"}
                required
                minLength={needsSetup ? 8 : undefined}
              />
            </div>
            {needsSetup && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
                {password && confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
              </div>
            )}
            {error && (
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "An error occurred"}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={pending || (needsSetup && password !== confirmPassword)}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {needsSetup ? "Create Account" : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
