import { useState } from 'react';
import { authApi } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';

interface Props {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: Props) {
  const [url, setUrl] = useState(() => localStorage.getItem('admin_portal_url') || 'http://localhost:8080');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    localStorage.setItem('admin_portal_url', url);
    setLoading(true);
    try {
      const res = await authApi.login(username, password);
      localStorage.setItem('admin_token', res.token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>CloudAgents Admin</CardTitle>
            <CardDescription>企业管理平面</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel>服务器地址</FieldLabel>
                  <Input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://localhost:8080"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>用户名</FieldLabel>
                  <Input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>密码</FieldLabel>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? '登录中...' : '登录'}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
