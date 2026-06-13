import { useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw, CheckCircle, XCircle, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { deptApi, type Department } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

export function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [testResults, setTestResults] = useState<Record<string, boolean | null>>({});

  const fetch = () => {
    setLoading(true);
    deptApi.list().then(setDepartments).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetch(); }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除部门「${name}」？`)) return;
    try {
      await deptApi.delete(id);
      toast.success('已删除');
      fetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleTest = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: null }));
    try {
      const res = await deptApi.testConnection(id);
      setTestResults((prev) => ({ ...prev, [id]: res.ok }));
      toast[res.ok ? 'success' : 'error'](res.ok ? '连接成功' : '连接失败');
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: false }));
      toast.error('连接失败');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">部门管理</h2>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1.5" />
          添加部门
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-center py-12">加载中...</div>
      ) : departments.length === 0 ? (
        <div className="text-muted-foreground text-center py-12">暂无部门，点击上方按钮添加</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">部门名称</th>
                  <th className="px-4 py-3 font-medium">后端地址</th>
                  <th className="px-4 py-3 font-medium">前端地址</th>
                  <th className="px-4 py-3 font-medium">管理员</th>
                  <th className="px-4 py-3 font-medium">密码</th>
                  <th className="px-4 py-3 font-medium">连接状态</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {departments.map((dept) => (
                  <tr key={dept.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-3 font-medium">{dept.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{dept.backend_url}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{dept.frontend_url || '-'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{dept.admin_username}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{dept.admin_password}</td>
                    <td className="px-4 py-3">
                      {testResults[dept.id] === true && (
                        <Badge variant="default" className="text-xs gap-1">
                          <CheckCircle className="w-3 h-3" /> 正常
                        </Badge>
                      )}
                      {testResults[dept.id] === false && (
                        <Badge variant="destructive" className="text-xs gap-1">
                          <XCircle className="w-3 h-3" /> 失败
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleTest(dept.id)} title="测试连接">
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setEditDept(dept)} title="编辑">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(dept.id, dept.name)} title="删除" className="text-destructive hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <CreateDeptDialog open={showCreate} onOpenChange={setShowCreate} onCreated={fetch} />
      <EditDeptDialog dept={editDept} onClose={() => setEditDept(null)} onUpdated={fetch} />
    </div>
  );
}

function EditDeptDialog({ dept, onClose, onUpdated }: { dept: Department | null; onClose: () => void; onUpdated: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [frontendUrl, setFrontendUrl] = useState('');
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (dept) {
      setName(dept.name);
      setUrl(dept.backend_url);
      setFrontendUrl(dept.frontend_url || '');
      setAdminUser(dept.admin_username);
      setAdminPass(dept.admin_password || '');
      setError('');
    }
  }, [dept]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dept) return;
    setError('');
    setLoading(true);
    try {
      const data: Record<string, string> = { name, backend_url: url, frontend_url: frontendUrl, admin_username: adminUser };
      if (adminPass) data.admin_password = adminPass;
      await deptApi.update(dept.id, data);
      toast.success('已更新');
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!dept} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑部门</DialogTitle>
          <DialogDescription>修改部门信息，密码留空则不修改</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel>部门名称</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field>
              <FieldLabel>后端地址</FieldLabel>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} required className="font-mono" />
            </Field>
            <Field>
              <FieldLabel>前端地址</FieldLabel>
              <Input value={frontendUrl} onChange={(e) => setFrontendUrl(e.target.value)} className="font-mono" placeholder="如 http://192.168.31.132:5173" />
            </Field>
            <Field>
              <FieldLabel>管理员用户名</FieldLabel>
              <Input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} required />
            </Field>
            <Field>
              <FieldLabel>管理员密码</FieldLabel>
              <Input type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} placeholder="留空不修改" />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button variant="ghost" type="button" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={loading}>{loading ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateDeptDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('http://');
  const [frontendUrl, setFrontendUrl] = useState('');
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setName(''); setUrl('http://'); setFrontendUrl(''); setAdminUser('admin'); setAdminPass(''); setError(''); }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await deptApi.create({ name, backend_url: url, frontend_url: frontendUrl, admin_username: adminUser, admin_password: adminPass });
      toast.success('部门已创建');
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加部门</DialogTitle>
          <DialogDescription>注册一个部门后端实例</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel>部门名称</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：研发部" required />
            </Field>
            <Field>
              <FieldLabel>后端地址</FieldLabel>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.31.132:8300" required className="font-mono" />
            </Field>
            <Field>
              <FieldLabel>前端地址</FieldLabel>
              <Input value={frontendUrl} onChange={(e) => setFrontendUrl(e.target.value)} placeholder="http://192.168.31.132:5173" className="font-mono" />
            </Field>
            <Field>
              <FieldLabel>管理员用户名</FieldLabel>
              <Input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} required />
            </Field>
            <Field>
              <FieldLabel>管理员密码</FieldLabel>
              <Input type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} required />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={loading}>{loading ? '创建中...' : '创建'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
