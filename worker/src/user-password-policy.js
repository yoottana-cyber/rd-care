// School self-hosting candidate: stronger passwords required for newly created
// teacher accounts. Existing salted hashes are still verified by password.js.
export function userPasswordMinimum(role){
 return role==='teacher'?10:12;
}
export function validateUserPassword(password,role){
 const min=userPasswordMinimum(role);
 return typeof password==='string'&&password.length>=min&&password.length<=128
  && !/[\u0000-\u001f\u007f]/.test(password)&& !/^\d{13}$/.test(password);
}
