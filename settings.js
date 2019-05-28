var express = require('express');
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var net = require('net'), Socket = net.Socket;
var exec = require('child_process').exec;
var mkdirp = require('mkdirp');
var request = require('request');
settings = "";
const low = require('lowdb');
const nw = require('nw');
const FileSync = require('lowdb/adapters/FileSync');
const onvif = require('node-onvif');
const Stream = require('node-rtsp-stream');
app.use('/assets', express.static(__dirname + '/pages/assets'));
app.use('/', express.static(__dirname + '/pages/'));
console.log(nw);
jo = "";
rec_active = false;
var netServer = net.createServer(function(c) {
    console.log('client connected');
    data = {type: "root", dataq: root_folder};
    data = JSON.stringify(data);
    c.write(data);
    rec_active  = true;
    jo.emit("rec_active");
    c.on('close', function() {
        jo.emit("rec_stop");
    });
    c.on('error',function(){})
    c.on('data', function(data) {
        console.log(data);
        data = JSON.parse(data.toString());
        jo.emit("notification", data);
    });
});
setTimeout(function(){
    netServer.listen(3031);
},1000);
io.on('connection', function (socket) {
    jo = socket;
    
    function authorization (data) {
        request.post('http://smart-resto.ru/andrey_maps/dev/api/v1/Auth/login.php',
        {
            form: {
                login: data[0].value,
                pass: data[1].value
            }
        }, function (err, res, body) {
            if (err) {
                socket.emit("notification", {type: "auth_no_internet"});
            } else {
                result = JSON.parse(body);
                console.log(result);
                if (result.status === 'Error') {
                    socket.emit("notification", {type: "auth_error"});
                } else {
                    mac = require('node-macaddress').one(function (err, addr) {
                    });
                    /* dep = result.data;
                    socket.emit('isAuthorization', {пее
                        status: true,
                        isDep: false,
                        department: dep.department,
                    }); */         
                    settings.get('main[0]').assign({
                        login: data[0].value,
                        organization: result.data.organizationId,
                        password: result.pass,
                        mac: mac
                    }).write();
                    socket.emit("select_dep", result.data.department);
                }
            }
        });
    }
    root_folder = "";
    start_folder = "";
    socket.on('rec_status', function(){
        if(rec_active){
            socket.emit('rec_active');
        }
    });
    socket.on('root_folder', function(p){
        root_folder = p.root;
        start_folder = p.start;
        const adapter_set = new FileSync(root_folder + '\\settings.json');
        settings = low(adapter_set);
        settings.defaults({ main: [{
            "url": "http://91.221.70.7:3000/sendVideo",
            "remoteServer": "91.221.70.7",
            "timeLimit": 10,
            "port": "554",
            "folder": root_folder,
            "key": "Juw11Yz09JuqQfaB"
          }], cams: [] })
    .write();
    });
    socket.on('scan_network', function (exception) {
        settings.get('cams').each((item) => {item.available = false, item.visible = false}).write();
        index = settings.get('cams').size().value();
        onvif.startProbe().then((device_info_list) => {
            socket.emit("notification", {type: "cam_count", data: device_info_list.length});
            device_info_list.forEach((info) => {
                exist = settings.get('cams').filter({un: info.urn}).value();
                host = info.xaddrs[0];
                var rePattern = new RegExp(/\d{1,3}(\.\d{1,3}){3}/);
                var host = host.match(rePattern)[0];
                if (exist == "") {
                    index++;
                    let path = root_folder + "\\videos\\" + index;
                    mkdirp(path);
                    console.log(path);
                    settings.get('cams').push({
                        host: host,
                        title: "Без названия",
                        active: false,
                        id: index,
                        mark: info.name,
                        model: info.hardware,
                        quality: 0,
                        available: true, 
                        visible: true,
                        un: info.urn,
                        pid: 0,
                        login: "admin",
                        password: "admin"
                    }).write();
                } else {
                    settings.get('cams').find({un:info.urn}).assign({
                        visible: true,
                        available: true
                    }).write();
                }
            });
        }).then(() => {
            socket.emit("cams_list", settings.get('cams').filter({visible:true}).value());
        }).catch((error) => {
            console.error(error);
        });
    });
    socket.on("start_preview", function(){
        socket.broadcast.emit("start_preview");
    });
    
    
    socket.on("err_auth_cam", function(){
        socket.broadcast.emit("notification", {type: "no_auth"});
    });
    socket.on("start_rec", function(data){
        to = exec("node record.js");
        settings.get("main[0]").assign({pid: to.pid}).write();
    });
    socket.on("auth_data", function(data){
        authorization(data);
    });
    socket.on("auth", function(data){
        settings.get("main[0]").assign({auth: data}).write();
    });
    socket.on("update_dep", function(data){
        settings.get("main[0]").assign({department: data}).write();
    });
    socket.on("stop_rec", function(data){
        exec("taskkill /f /im node.exe");
        exec("taskkill /f /im ffmpeg.exe");
    });
    socket.on('change_cam_status', function(data) {
        title = settings.get('cams').find({id: data[0]}).value();
        settings.get('cams').find({id: data[0]}).assign({active: data[1]}).write();
        socket.emit("notification", {type: "change_cam_status", status: data[1], title: title.title+" ("+title.id+")"});
    });
    socket.on("request_cam_settings", function(data) {
        cam = settings.get('cams').find({id: data}).value();
        setTimeout(function(){
            socket.emit("give_cam_settings", cam);
        }, 10);
    });
    socket.on("cam_settings_update", function(data) {
        settings.get('cams').find({id: parseInt(data.cam_id)}).assign({login: data.login, quality: data.quality, password: data.password, title: data.title}).write();
    });
    socket.on("update_settings", function(data) {
        if (!data[2]) {
            data[2] = {value: false};
            exec("REG DELETE HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v smarteyes /f");
        } else {
            data[2] = {value: true};
            exec("REG ADD HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v smarteyes /t REG_SZ /d \""+start_folder+"\\smarteyes.exe autostart\"");
        }
        console.log(data[2]);
        settings.get('main[0]').assign({maxDirSize: data[0].value, department: data[1].value, autostart: data[2].value}).write();
        setTimeout(function(){
            socket.emit("notification", {type: "success_update"});
        }, 10);
    });
    re = "";
    socket.on("preview", function(data){
        title = settings.get('cams').find({id: data.id}).value();
        re = new Stream({
            name: data.id,
            streamUrl: "rtsp://"+data.login+":"+data.password+"@"+cam.host+":554/cam/realmonitor?channel=1&subtype=1&unicast=true&proto=Onvif",
            wsPort: 9999
        });
        console.log(re);
    });
    socket.on("stop_preview", function(){
        re.stop();
    });
});

http.listen(3000);