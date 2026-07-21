import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminImpersonation } from './admin-impersonation';

describe('AdminImpersonation', () => {
  let component: AdminImpersonation;
  let fixture: ComponentFixture<AdminImpersonation>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminImpersonation],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminImpersonation);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
