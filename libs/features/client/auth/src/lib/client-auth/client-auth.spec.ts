import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClientAuth } from './client-auth';

describe('ClientAuth', () => {
  let component: ClientAuth;
  let fixture: ComponentFixture<ClientAuth>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientAuth],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientAuth);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
