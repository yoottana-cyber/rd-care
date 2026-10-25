// Four characters for demo teacher accounts per school request.
// Staff and administrator accounts retain a stricter minimum.
export function userPasswordMinimum(role){
 return role==='teacher'?4:12;
}
export function validateUserPassword(password,role){
 const min=userPasswordMinimum(role);
 return typeof password==='string'&&password.length>=min&&password.length<=128
  && !/[\u0000-\u001f\u007f]/.test(password)&& !/^\d{13}$/.test(password);
}
