import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";

type UserRole = 'admin' | 'user' | 'viewer';

interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  mustChangePassword?: boolean;
}

interface AuthStatus {
  needsSetup: boolean;
}

export function useAuth() {
  const {
    data: user,
    isLoading,
    error,
  } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });

  const { data: authStatus } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60_000,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", credentials);
      return (await res.json()) as AuthUser;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    },
  });

  const setupMutation = useMutation({
    mutationFn: async (credentials: { password: string }) => {
      const res = await apiRequest("POST", "/api/auth/setup", credentials);
      return (await res.json()) as AuthUser;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.invalidateQueries();
    },
  });

  return {
    user: user ?? null,
    isLoading,
    error,
    isAdmin: user?.role === "admin",
    isViewer: user?.role === "viewer",
    mustChangePassword: user?.mustChangePassword ?? false,
    needsSetup: authStatus?.needsSetup ?? false,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error,
    loginPending: loginMutation.isPending,
    setup: setupMutation.mutateAsync,
    setupError: setupMutation.error,
    setupPending: setupMutation.isPending,
    logout: logoutMutation.mutateAsync,
  };
}
