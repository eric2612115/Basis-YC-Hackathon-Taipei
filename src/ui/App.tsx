import { APP_NAME } from '../data/samples';
import { StoreProvider, useStore } from './store';
import { useView, type View } from './hooks';
import { Borrow } from './Borrow';
import { Buy } from './Buy';
import { Prices } from './Prices';
import { Mark } from './Mark';

const TABS: { view: View; label: string }[] = [
  { view: 'borrow', label: 'Borrow' },
  { view: 'buy', label: 'Buy' },
  { view: 'prices', label: 'Prices' },
];

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const view = useView();
  const { kind } = useStore();
  return (
    <>
      <header className="top">
        <div className="top-inner">
          <a className="brand" href="#/borrow">
            <Mark /> {APP_NAME}
          </a>
          <nav aria-label="Views">
            {TABS.map((t) => (
              <a key={t.view} href={`#/${t.view}`} className={view === t.view ? 'on' : undefined} aria-current={view === t.view ? 'page' : undefined}>
                {t.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {view === 'borrow' && <Borrow />}
        {view === 'buy' && <Buy key={kind} />}
        {view === 'prices' && <Prices />}
      </main>
      <footer className="foot">
        <span>Sample data</span>
        <span>Indicative prices</span>
        <span>Not a loan offer</span>
      </footer>
    </>
  );
}
