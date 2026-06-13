import { useEffect, useState } from 'react';
import { Building2, Bot, Users, Wifi } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { dashboardApi, type DashboardData } from '@/api/client';

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi.get().then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>;
  }

  if (!data) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">无法加载数据</div>;
  }

  const stats = [
    { label: '部门总数', value: data.total_departments, icon: Building2, color: 'text-blue-600 bg-blue-50' },
    { label: '在线部门', value: data.online_departments, icon: Wifi, color: 'text-green-600 bg-green-50' },
    { label: '总 Agent 数', value: data.total_agents, icon: Bot, color: 'text-purple-600 bg-purple-50' },
    { label: '总员工数', value: data.total_users, icon: Users, color: 'text-orange-600 bg-orange-50' },
  ];

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Dashboard</h2>

      <div className="grid grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="text-3xl font-bold mt-1">{s.value}</p>
                </div>
                <div className={`p-3 rounded-lg ${s.color}`}>
                  <s.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <h3 className="text-lg font-semibold">部门状态</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.departments.map((dept) => (
          <Card key={dept.id}>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold">{dept.name}</h4>
                <Badge variant={dept.online ? 'default' : 'destructive'} className="text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full mr-1 ${dept.online ? 'bg-green-400' : 'bg-red-400'}`} />
                  {dept.online ? '在线' : '离线'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono">{dept.backend_url}</p>
              <div className="flex gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Bot className="w-3.5 h-3.5" />
                  {dept.agent_count} Agent
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {dept.user_count} 员工
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
        {data.departments.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            暂未注册部门，请在「部门管理」中添加
          </div>
        )}
      </div>
    </div>
  );
}
