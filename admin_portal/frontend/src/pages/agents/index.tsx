import { useEffect, useState } from 'react';
import { Bot, ExternalLink, Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { agentsApi, deptApi, type DeptAgents } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function AgentsPage() {
  const [data, setData] = useState<DeptAgents[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    agentsApi.all()
      .then((res) => setData(res.departments))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openChat = async (dept: DeptAgents, agentId: string) => {
    const key = `${dept.department_id}:${agentId}`;
    setOpening(key);
    try {
      const res = await deptApi.getToken(dept.department_id);
      const frontendUrl = res.frontend_url || dept.frontend_url || dept.backend_url.replace(':8300', ':5173');
      const url = `${frontendUrl}/chat/${agentId}?auto_token=${encodeURIComponent(res.token)}&server_url=${encodeURIComponent(res.backend_url)}`;
      window.open(url, '_blank');
    } catch {
      toast.error('获取部门令牌失败');
    } finally {
      setOpening(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Agent 总览</h2>

      {data.length === 0 ? (
        <div className="text-muted-foreground text-center py-12">暂无部门数据</div>
      ) : (
        data.map((dept) => (
          <div key={dept.department_id} className="space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold">{dept.department_name}</h3>
              <Badge variant="outline" className="text-xs font-mono">
                {dept.backend_url}
              </Badge>
            </div>

            {dept.agents.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-6">暂无 Agent</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pl-6">
                {dept.agents.map((agent) => (
                  <Card key={agent.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                          <Bot className="w-4 h-4" />
                        </div>
                        <h4 className="font-medium text-sm">{agent.name}</h4>
                      </div>
                      {agent.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {agent.description}
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        disabled={opening === `${dept.department_id}:${agent.id}`}
                        onClick={() => openChat(dept, agent.id)}
                      >
                        {opening === `${dept.department_id}:${agent.id}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        打开聊天
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
