import { useTitle } from '../lib/hooks';
import { ErrorBox, Grid } from '../components/ui';
import { useDeals } from './Home';

export default function Deals() {
  useTitle('Deals');
  const { data, isLoading, isError, error, refetch } = useDeals();
  if (isError) return <ErrorBox error={error} retry={refetch} />;
  return (
    <>
      <h1 className="section-title">Today's best deals</h1>
      <section><h2 className="section-title sm">🔥 Price drops vs 30-day average</h2><Grid items={data?.drops} loading={isLoading} /></section>
      <section><h2 className="section-title sm">🏷️ Biggest discounts off MRP</h2><Grid items={data?.discounts} loading={isLoading} /></section>
      <section><h2 className="section-title sm">💸 Most saved by comparing stores</h2><Grid items={data?.spreads} loading={isLoading} /></section>
    </>
  );
}
