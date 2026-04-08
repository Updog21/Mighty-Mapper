import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Users as UsersIcon, Plus, Trash2, Shield, Loader2, Check, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface UserEntry {
  id: string;
  username: string;
  role: string;
  createdAt?: string;
}

export default function UsersPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Create user form
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/users', { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin, fetchUsers]);

  const createUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      setMessage('Username and password are required.');
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
          requirePasswordChange,
        }),
        credentials: 'include',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to create user');
      }
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setRequirePasswordChange(false);
      setCreateOpen(false);
      setMessage('User created successfully.');
      await fetchUsers();
    } catch (err: any) {
      setMessage(err.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const updateRole = async (userId: string, role: string) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/auth/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
        credentials: 'include',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to update role');
      }
      setMessage('Role updated.');
      await fetchUsers();
    } catch (err: any) {
      setMessage(err.message || 'Failed to update role');
    }
  };

  const deleteUser = async (userId: string, username: string) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    setMessage(null);
    try {
      const response = await fetch(`/api/auth/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Failed to delete user');
      }
      setMessage('User deleted.');
      await fetchUsers();
    } catch (err: any) {
      setMessage(err.message || 'Failed to delete user');
    }
  };

  const roleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Admin</Badge>;
      case 'viewer':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">Viewer</Badge>;
      default:
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">User</Badge>;
    }
  };

  if (!isAdmin) {
    return (
      <AppShell contentClassName="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Users</h1>
        </header>
        <Alert variant="destructive">
          <AlertDescription>You do not have permission to manage users.</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell contentClassName="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">User Management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Create, manage, and remove user accounts
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>Add a new user account to the system.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Username</label>
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter username"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter password"
                />
                <p className="text-xs text-muted-foreground">Min 8 characters, must include uppercase, lowercase, and a number.</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Role</label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="require-password-change"
                  checked={requirePasswordChange}
                  onCheckedChange={(checked) => setRequirePasswordChange(checked === true)}
                />
                <label htmlFor="require-password-change" className="text-sm">
                  Require password change on first login
                </label>
              </div>
              <Button onClick={createUser} disabled={creating} className="w-full">
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create User'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Role Permissions
          </CardTitle>
          <CardDescription>Capabilities available to each role</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-medium text-foreground">Permission</th>
                  <th className="py-2 px-4 font-medium">Admin</th>
                  <th className="py-2 px-4 font-medium">User</th>
                  <th className="py-2 px-4 font-medium">Viewer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-2 pr-4">Access app and view data (techniques, detections, data components, products)</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Create products</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Edit product streams / hybrid selector</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /><span className="ml-1 text-xs text-muted-foreground">(owner)</span></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Manage product aliases (add / remove)</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /><span className="ml-1 text-xs text-muted-foreground">(owner)</span></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Delete products</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /><span className="ml-1 text-xs text-muted-foreground">(owner)</span></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Run Auto Mapper for a product</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /><span className="ml-1 text-xs text-muted-foreground">(owner)</span></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Update SSM mapping metadata</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Admin tasks (repo syncs, maintenance)</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Manage users</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Bulk ingest (products, data components, strategies, analytics, assets)</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Initialize MITRE STIX graph</td>
                  <td className="py-2 px-4"><Check className="w-4 h-4 text-green-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                  <td className="py-2 px-4"><X className="w-4 h-4 text-red-500" aria-hidden="true" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-primary" />
            Accounts
          </CardTitle>
          <CardDescription>{users.length} registered user{users.length !== 1 ? 's' : ''}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading users...
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/50 p-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold text-primary">
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{user.username}</p>
                      {user.createdAt && (
                        <p className="text-xs text-muted-foreground">
                          Created {new Date(user.createdAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {roleBadge(user.role)}
                    <Select
                      value={user.role}
                      onValueChange={(value) => updateRole(user.id, value)}
                    >
                      <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteUser(user.id, user.username)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
