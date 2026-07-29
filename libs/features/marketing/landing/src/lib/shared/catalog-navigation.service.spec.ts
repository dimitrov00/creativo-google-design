import { TestBed } from '@angular/core/testing';
import { CatalogNavigationService } from './catalog-navigation.service';
import { SERVICES } from '../content/landing-content';

const service = (id: string) => {
  const found = SERVICES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no seed service ${id}`);
  return found;
};

describe('CatalogNavigationService', () => {
  let catalog: CatalogNavigationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    catalog = TestBed.inject(CatalogNavigationService);
  });

  it('starts closed', () => {
    expect(catalog.current()).toBeNull();
  });

  it('opens on a service', () => {
    catalog.open(service('haircut'));
    expect(catalog.current()).toBe(service('haircut'));
  });

  it('REPLACES the subject when a reference is followed — never stacks', () => {
    catalog.open(service('fullcare'));
    catalog.open(service('haircut'));

    // One subject, no history: following a reference is "show me that one
    // instead", not a push with something to unwind.
    expect(catalog.current()).toBe(service('haircut'));
  });

  it('closes outright', () => {
    catalog.open(service('fade'));
    catalog.close();
    expect(catalog.current()).toBeNull();
  });
});
