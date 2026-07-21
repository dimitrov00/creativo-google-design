import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClientAccount } from './client-account';

describe('ClientAccount', () => {
  let component: ClientAccount;
  let fixture: ComponentFixture<ClientAccount>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientAccount],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientAccount);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
