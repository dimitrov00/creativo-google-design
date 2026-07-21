import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClientBooking } from './client-booking';

describe('ClientBooking', () => {
  let component: ClientBooking;
  let fixture: ComponentFixture<ClientBooking>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientBooking],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientBooking);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
