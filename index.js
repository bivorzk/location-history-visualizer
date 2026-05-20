( function ( $, L, prettySize ) {
	var map, heat, allLatlngs = [],
		heatOptions = {
			tileOpacity: 1,
			heatOpacity: 1,
			radius: 25,
			blur: 15
		};

	function status( message ) {
		$( '#currentStatus' ).text( message );
	}
	// Start at the beginning
	stageOne();

	function stageOne () {
		var dropzone;

		// Initialize the map
		map = L.map( 'map' ).setView( [0,0], 2 );
		L.tileLayer( 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: 'location-history-visualizer is open source and available <a href="https://github.com/theopolisme/location-history-visualizer">on GitHub</a>. Map data &copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors.',
			maxZoom: 18,
			minZoom: 2
		} ).addTo( map );

		// Initialize the dropzone
		dropzone = new Dropzone( document.body, {
			url: '/',
			previewsContainer: document.createElement( 'div' ), // >> /dev/null
			clickable: false,
			accept: function ( file, done ) {
				stageTwo( file );
				dropzone.disable(); // Your job is done, buddy
			}
		} );

		// For mobile browsers, allow direct file selection as well
		$( '#file' ).change( function () {
			stageTwo( this.files[0] );
			dropzone.disable();
		} );
	}

	function stageTwo ( file ) {
    // Google Analytics event - heatmap upload file
    ga('send', 'event', 'Heatmap', 'upload', undefined, file.size);

		heat = L.heatLayer( [], heatOptions ).addTo( map );

		var type;

		try {
			if ( /\.kml$/i.test( file.name ) ) {
				type = 'kml';
			} else {
				type = 'json';
			}
		} catch ( ex ) {
			status( 'Something went wrong generating your map. Ensure you\'re uploading a Google Takeout JSON file that contains location data and try again, or create an issue on GitHub if the problem persists. ( error: ' + ex.message + ' )' );
			return;
		}

		// First, change tabs
		$( 'body' ).addClass( 'working' );
		$( '#intro' ).addClass( 'hidden' );
		$( '#working' ).removeClass( 'hidden' );

		var fileSize = prettySize( file.size );

		status( 'Preparing to import file ( ' + fileSize + ' )...' );

		if ( type === 'json' ) parseJSONFile( file );
		if ( type === 'kml' ) parseKMLFile( file );
	}

	function stageThree ( numberProcessed ) {
    // Google Analytics event - heatmap render
    ga('send', 'event', 'Heatmap', 'render', undefined, numberProcessed);

		var $done = $( '#done' );

		// Change tabs :D
		$( 'body' ).removeClass( 'working' );
		$( '#working' ).addClass( 'hidden' );
		$done.removeClass( 'hidden' );

		// Update count
		$( '#numberProcessed' ).text( numberProcessed.toLocaleString() );

    $( '#launch' ).click( function () {
      var $email = $( '#email' );
      if ( $email.is( ':valid' ) ) {
        $( this ).text( 'Launching... ' );
        $.post( '/heatmap/submit-email.php', {
          email: $email.val()
        } )
        .always( function () {
          $( 'body' ).addClass( 'map-active' );
          $done.fadeOut();
          activateControls();
        } );
      } else {
        alert( 'Please enter a valid email address to proceed.' );
      }
    } );

		function activateControls () {
			var $tileLayer = $( '.leaflet-tile-pane' ),
				$heatmapLayer = $( '.leaflet-heatmap-layer' ),
				originalHeatOptions = $.extend( {}, heatOptions ); // for reset

			// Update values of the dom elements
			function updateInputs () {
				var option;
				for ( option in heatOptions ) {
					if ( heatOptions.hasOwnProperty( option ) ) {
						document.getElementById( option ).value = heatOptions[option];
					}
				}
			}

			updateInputs();

			$( '.control' ).change( function () {
				switch ( this.id ) {
					case 'tileOpacity':
						$tileLayer.css( 'opacity', this.value );
						break;
					case 'heatOpacity':
						$heatmapLayer.css( 'opacity', this.value );
						break;
					default:
						heatOptions[ this.id ] = Number( this.value );
						heat.setOptions( heatOptions );
						break;
				}
			} );

			$( '#reset' ).click( function () {
				$.extend( heatOptions, originalHeatOptions );
				updateInputs();
				heat.setOptions( heatOptions );
				// Reset opacity too
				$heatmapLayer.css( 'opacity', originalHeatOptions.heatOpacity );
				$tileLayer.css( 'opacity', originalHeatOptions.tileOpacity );
			} );

			$( '#addFiles' ).click( function () {
				$( '#addFileInput' ).val( '' ).click();
			} );

			$( '#addFileInput' ).change( function () {
				if ( this.files.length > 0 ) {
					processAdditionalFiles( this.files );
				}
			} );
		}
	}

	/*
	Worker source — runs off the main thread so the UI never freezes.
	Uses regex instead of a streaming JSON parser: order-of-magnitude faster
	and handles all three supported file formats in a single pass each.
	*/
	var WORKER_SRC = [
		'var S=1e-7,FIX=Math.pow(2,32)*S;',
		'function f(n){return n>180?n-FIX:n;}',
		'self.onmessage=function(e){',
		'  var file=e.data;',
		'  self.postMessage({type:"status",text:"Reading file..."});',
		'  var text;',
		'  try{text=new FileReaderSync().readAsText(file);}',
		'  catch(ex){self.postMessage({type:"error",text:ex.message});return;}',
		'  self.postMessage({type:"status",text:"Extracting coordinates..."});',
		'  var pts=[],m;',
		// Timeline.json — timelinePath points: "point":"lat\u00b0, lng\u00b0"
		'  var r1=/"point"\\s*:\\s*"([-\\d.]+)\\u00b0,\\s*([-\\d.]+)\\u00b0"/g;',
		'  while((m=r1.exec(text))!==null)pts.push([parseFloat(m[1]),parseFloat(m[2])]);',
		// Timeline.json — activity/visit: "latLng":"lat\u00b0, lng\u00b0"
		'  var r2=/"latLng"\\s*:\\s*"([-\\d.]+)\\u00b0,\\s*([-\\d.]+)\\u00b0"/g;',
		'  while((m=r2.exec(text))!==null)pts.push([parseFloat(m[1]),parseFloat(m[2])]);',
		// Timeline Edits.json — "latE7":N,"lngE7":N (always in same small object)
		'  var r3=/"latE7"\\s*:\\s*(-?\\d+)[\\s\\S]{0,200}?"lngE7"\\s*:\\s*(-?\\d+)/g;',
		'  while((m=r3.exec(text))!==null)pts.push([f(+m[1]*S),f(+m[2]*S)]);',
		// LocationHistory.json (legacy) — "latitudeE7":N,"longitudeE7":N
		'  var r4=/"latitudeE7"\\s*:\\s*(-?\\d+)[\\s\\S]{0,200}?"longitudeE7"\\s*:\\s*(-?\\d+)/g;',
		'  while((m=r4.exec(text))!==null)pts.push([f(+m[1]*S),f(+m[2]*S)]);',
		'  self.postMessage({type:"done",latlngs:pts});',
		'};'
	].join( '\n' );

	function parseJSONFile( file ) {
		var url = URL.createObjectURL( new Blob( [ WORKER_SRC ], { type: 'application/javascript' } ) );
		var worker = new Worker( url );

		worker.onmessage = function ( e ) {
			var msg = e.data;
			if ( msg.type === 'status' ) {
				status( msg.text );
			} else if ( msg.type === 'done' ) {
				URL.revokeObjectURL( url );
				status( 'Generating map...' );
				allLatlngs = msg.latlngs;
				heat._latlngs = allLatlngs;
				heat.redraw();
				stageThree( allLatlngs.length );
				worker.terminate();
			} else if ( msg.type === 'error' ) {
				URL.revokeObjectURL( url );
				status( 'Error processing file: ' + msg.text );
				worker.terminate();
			}
		};

		worker.onerror = function ( e ) {
			URL.revokeObjectURL( url );
			status( 'Could not start worker: ' + e.message );
		};

		worker.postMessage( file );
	}

	function processAdditionalFiles( files ) {
		var queue = Array.prototype.slice.call( files );

		function next() {
			if ( queue.length === 0 ) return;
			var file = queue.shift();
			var isKml = /\.kml$/i.test( file.name );
			$( '#addStatus' ).text( 'Processing ' + file.name + '...' );

			if ( !isKml ) {
				var url = URL.createObjectURL( new Blob( [ WORKER_SRC ], { type: 'application/javascript' } ) );
				var worker = new Worker( url );
				worker.onmessage = function ( e ) {
					var msg = e.data;
					if ( msg.type === 'status' ) {
						$( '#addStatus' ).text( msg.text );
					} else if ( msg.type === 'done' ) {
						URL.revokeObjectURL( url );
						Array.prototype.push.apply( allLatlngs, msg.latlngs );
						heat._latlngs = allLatlngs;
						heat.redraw();
						$( '#numberProcessed' ).text( allLatlngs.length.toLocaleString() );
						$( '#addStatus' ).text( 'Added ' + msg.latlngs.length.toLocaleString() + ' points from ' + file.name );
						worker.terminate();
						next();
					} else if ( msg.type === 'error' ) {
						URL.revokeObjectURL( url );
						$( '#addStatus' ).text( 'Error in ' + file.name + ': ' + msg.text );
						worker.terminate();
						next();
					}
				};
				worker.onerror = function ( e ) {
					URL.revokeObjectURL( url );
					$( '#addStatus' ).text( 'Worker error: ' + e.message );
					next();
				};
				worker.postMessage( file );
			} else {
				var reader = new FileReader();
				reader.onload = function ( e ) {
					var latlngs = getLocationDataFromKml( e.target.result );
					Array.prototype.push.apply( allLatlngs, latlngs );
					heat._latlngs = allLatlngs;
					heat.redraw();
					$( '#numberProcessed' ).text( allLatlngs.length.toLocaleString() );
					$( '#addStatus' ).text( 'Added ' + latlngs.length.toLocaleString() + ' points from ' + file.name );
					next();
				};
				reader.onerror = function () {
					$( '#addStatus' ).text( 'Error reading ' + file.name );
					next();
				};
				reader.readAsText( file );
			}
		}

		next();
	}

	function parseKMLFile( file ) {
		var fileSize = prettySize( file.size );
		var reader = new FileReader();
		reader.onprogress = function ( e ) {
			var percentLoaded = Math.round( ( e.loaded / e.total ) * 100 );
			status( percentLoaded + '% of ' + fileSize + ' loaded...' );
		};

		reader.onload = function ( e ) {
			status( 'Generating map...' );
			var latlngs = getLocationDataFromKml( e.target.result );
			allLatlngs = latlngs;
			heat._latlngs = allLatlngs;
			heat.redraw();
			stageThree( allLatlngs.length );
		}
		reader.onerror = function () {
			status( 'Something went wrong reading your JSON file. Ensure you\'re uploading a "direct-from-Google" JSON file and try again, or create an issue on GitHub if the problem persists. ( error: ' + reader.error + ' )' );
		}
		reader.readAsText( file );
	}

	function getLocationDataFromKml( data ) {
		var KML_DATA_REGEXP = /<when>( .*? )<\/when>\s*<gx:coord>( \S* )\s( \S* )\s( \S* )<\/gx:coord>/g,
			locations = [],
			match = KML_DATA_REGEXP.exec( data );

		// match
		//  [ 1 ] ISO 8601 timestamp
		//  [ 2 ] longitude
		//  [ 3 ] latitude
		//  [ 4 ] altitude ( not currently provided by Location History )
		while ( match !== null ) {
			locations.push( [ Number( match[ 3 ] ), Number( match[ 2 ] ) ] );
			match = KML_DATA_REGEXP.exec( data );
		}

		return locations;
	}

}( jQuery, L, prettySize ) );
