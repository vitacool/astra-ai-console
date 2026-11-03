import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { Button } from './ui';

export function AccessDenied() {
  return (
    <div className="page">
      <div className="access-denied">
        <div className="access-denied-icon">
          <ShieldX size={30} />
        </div>
        <div className="page-eyebrow">ACCESS RESTRICTED</div>
        <h1>需要管理员权限</h1>
        <p>这个页面仅对工作区负责人和管理员开放。如需访问，请联系管理员调整角色。</p>
        <Link to="/">
          <Button variant="primary">返回总览</Button>
        </Link>
      </div>
    </div>
  );
}
