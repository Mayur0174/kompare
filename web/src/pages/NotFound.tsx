import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';

export default function NotFound() {
  return <Empty title="Page not found" icon="🧭"><Link className="btn primary" to="/">Go home</Link></Empty>;
}
