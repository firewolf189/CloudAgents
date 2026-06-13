import { useEffect, useState } from 'react';
import { Play, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { deptApi, orchestrateApi, type Department, type OrchestrationLog } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export function OrchestratePage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [logs, setLogs] = useState<OrchestrationLog[]>([]);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    deptApi.list().then(setDepartments).catch(() => {});
    orchestrateApi.logs().then(setLogs).catch(() => {});
  }, []);

  const toggleDept = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRun = async () => {
    if (!prompt.trim() || selectedIds.size === 0) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await orchestrateApi.run(prompt, Array.from(selectedIds));
      setResult(res.results);
      toast.success('编排完成');
      orchestrateApi.logs().then(setLogs).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '执行失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">跨部门编排</h2>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Department selection */}
          <div>
            <label className="block text-sm font-medium mb-2">选择目标部门</label>
            <div className="flex flex-wrap gap-2">
              {departments.map((dept) => (
                <Button
                  key={dept.id}
                  variant={selectedIds.has(dept.id) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleDept(dept.id)}
                >
                  {dept.name}
                </Button>
              ))}
              {departments.length === 0 && (
                <p className="text-sm text-muted-foreground">暂无部门，请先在部门管理中添加</p>
              )}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium mb-2">任务描述</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="如：总结本周工作进展，200字以内"
            />
          </div>

          <Button
            onClick={handleRun}
            disabled={running || !prompt.trim() || selectedIds.size === 0}
          >
            <Play className="w-4 h-4 mr-1.5" />
            {running ? '执行中...' : '执行编排'}
          </Button>

          {/* Results */}
          {result && (
            <>
              <Separator />
              <div className="space-y-3">
                <h4 className="text-sm font-medium">执行结果</h4>
                {Object.entries(result).map(([name, text]) => (
                  <Card key={name}>
                    <CardContent className="pt-4">
                      <p className="text-sm font-medium mb-1">{name}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{text}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold">执行历史</h3>
      </div>

      {logs.length === 0 ? (
        <p className="text-muted-foreground text-sm">暂无记录</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <Card key={log.id}>
              <button
                onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={log.status === 'done' ? 'default' : log.status === 'running' ? 'secondary' : 'outline'} className="text-xs">
                    {log.status === 'done' ? '完成' : log.status === 'running' ? '运行中' : log.status}
                  </Badge>
                  <span className="text-sm truncate max-w-md">{log.task_prompt}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                  <span>{new Date(log.created_at).toLocaleString()}</span>
                  {expandedLog === log.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>
              {expandedLog === log.id && log.results && (
                <div className="border-t px-4 py-3 space-y-2">
                  {Object.entries(log.results).map(([name, text]) => (
                    <div key={name}>
                      <p className="text-sm font-medium">{name}</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{text}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
