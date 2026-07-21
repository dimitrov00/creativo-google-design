import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClientOnboarding } from './client-onboarding';

describe('ClientOnboarding', () => {
  let component: ClientOnboarding;
  let fixture: ComponentFixture<ClientOnboarding>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientOnboarding],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientOnboarding);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
